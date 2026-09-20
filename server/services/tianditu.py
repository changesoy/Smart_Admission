"""tianditu.py - 天地图搜索上游封装

职责: 调用天地图 v2 搜索接口、归一化返回结构、按服务区域过滤、短时缓存。

token 只从 ``config`` 读取（最终来源为环境变量），本文件不出现任何 token 字面量。
地图瓦片不经过这里，仍由浏览器直连天地图 Tile Server。
"""

from __future__ import annotations

import json
import logging
import time
from typing import Any

import httpx

from ..config import (
    SEARCH_BOUNDS,
    SEARCH_CACHE_MAX_ENTRIES,
    SEARCH_CACHE_TTL_SECONDS,
    SEARCH_DEFAULT_COUNT,
    SEARCH_KEYWORD_PREFIX,
    SEARCH_MAX_COUNT,
    SEARCH_MAX_QUERY_LENGTH,
    SEARCH_TIMEOUT_SECONDS,
    TIANDITU_SEARCH_TK,
    TIANDITU_SEARCH_URL,
)
from ..errors import (
    BadRequestError,
    TokenMissingError,
    UpstreamError,
    UpstreamTimeoutError,
)

logger = logging.getLogger("server.tianditu")

# 上游返回体在日志中的截断长度；只用于诊断，不会带上请求 URL（URL 含 tk）
_LOG_BODY_LIMIT = 300

# 用于判断查询词是否已自带城市名，避免重复叠加前缀
_CITY_NAME = "泰安"


class _TtlCache:
    """极简 TTL 缓存，仅用于吸收短时间内的重复查询。"""

    def __init__(self, ttl_seconds: float, max_entries: int) -> None:
        self._ttl = ttl_seconds
        self._max_entries = max_entries
        self._items: dict[str, tuple[float, list[dict[str, Any]]]] = {}

    def get(self, key: str) -> list[dict[str, Any]] | None:
        item = self._items.get(key)
        if item is None:
            return None
        expires_at, value = item
        if time.monotonic() >= expires_at:
            del self._items[key]
            return None
        return value

    def set(self, key: str, value: list[dict[str, Any]]) -> None:
        if len(self._items) >= self._max_entries:
            self._evict_expired()
        if len(self._items) >= self._max_entries:
            self._items.pop(next(iter(self._items)))
        self._items[key] = (time.monotonic() + self._ttl, value)

    def _evict_expired(self) -> None:
        now = time.monotonic()
        for key in [k for k, (expires_at, _) in self._items.items() if now >= expires_at]:
            del self._items[key]


_CACHE = _TtlCache(SEARCH_CACHE_TTL_SECONDS, SEARCH_CACHE_MAX_ENTRIES)


def normalize_query(raw: str | None) -> str:
    """校验并归一查询关键词。"""
    query = (raw or "").strip()
    if not query:
        raise BadRequestError("缺少查询参数 q")
    if len(query) > SEARCH_MAX_QUERY_LENGTH:
        raise BadRequestError(f"查询关键词过长（上限 {SEARCH_MAX_QUERY_LENGTH} 字）")
    return query


def normalize_count(raw: str | None) -> int:
    """校验并归一返回条数。

    以字符串接收而非 int，是为了让非法取值也走统一的 BAD_REQUEST 结构，
    而不是 FastAPI 默认的 422 响应形状。
    """
    if raw is None or not raw.strip():
        return SEARCH_DEFAULT_COUNT
    try:
        count = int(raw)
    except ValueError as exc:
        raise BadRequestError(f"count 需为 1-{SEARCH_MAX_COUNT} 之间的整数") from exc
    if count < 1 or count > SEARCH_MAX_COUNT:
        raise BadRequestError(f"count 需为 1-{SEARCH_MAX_COUNT} 之间的整数")
    return count


async def search_pois(query: str, count: int) -> tuple[list[dict[str, Any]], bool]:
    """按关键词搜索 POI，返回 (服务区域内结果, 是否命中缓存)。"""
    if not TIANDITU_SEARCH_TK:
        raise TokenMissingError("服务端未配置天地图搜索 token（TIANDITU_SEARCH_TK）")

    cache_key = f"{query}|{count}"
    cached = _CACHE.get(cache_key)
    if cached is not None:
        return cached, True

    payload = _build_post_str(query, count)
    raw = await _request_upstream(payload)
    results = _filter_and_normalize(_extract_pois(raw))
    _CACHE.set(cache_key, results)
    return results, False


def _build_post_str(query: str, count: int) -> dict[str, str]:
    """构造天地图 v2 搜索所需的 postStr 参数。"""
    post_str = json.dumps(
        {
            "keyWord": _build_keyword(query),
            "level": "12",
            "mapBound": SEARCH_BOUNDS.as_map_bound(),
            "queryType": "1",
            "start": "0",
            "count": str(count),
        },
        ensure_ascii=False,
    )
    return {"postStr": post_str}


def _build_keyword(query: str) -> str:
    """补全省级以下的城市前缀，用于收敛上游检索范围。

    查询词本身已含城市名时保持原样：否则「泰安望岳中学」会被拼成
    「泰安市泰安望岳中学」，重复的「泰安」反而干扰上游的相关性排序。
    """
    if _CITY_NAME in query:
        return query
    return f"{SEARCH_KEYWORD_PREFIX}{query}"


async def _request_upstream(params: dict[str, str]) -> dict[str, Any]:
    """调用上游并把网络层异常归一为统一错误。"""
    query = {**params, "type": "query", "tk": TIANDITU_SEARCH_TK}
    try:
        async with httpx.AsyncClient(timeout=SEARCH_TIMEOUT_SECONDS) as client:
            response = await client.get(TIANDITU_SEARCH_URL, params=query)
    except httpx.TimeoutException as exc:
        raise UpstreamTimeoutError("上游搜索服务超时") from exc
    except httpx.HTTPError as exc:
        raise UpstreamError("上游搜索服务不可用") from exc

    if not 200 <= response.status_code < 300:
        logger.warning(
            "天地图搜索返回 HTTP %s: %s",
            response.status_code,
            response.text[:_LOG_BODY_LIMIT],
        )
        raise UpstreamError(f"上游搜索服务返回 HTTP {response.status_code}")

    try:
        payload = response.json()
    except ValueError as exc:
        logger.warning("天地图搜索返回非 JSON 内容: %s", response.text[:_LOG_BODY_LIMIT])
        raise UpstreamError("上游搜索服务返回了无法解析的内容") from exc

    if not isinstance(payload, dict):
        raise UpstreamError("上游搜索服务返回结构无法识别")
    return payload


def _extract_pois(payload: dict[str, Any]) -> list[dict[str, Any]]:
    """兼容 V2（``{"pois": [...]}``）与 V1（``{"result": {"pois": [...]}}``）两种结构。"""
    pois = payload.get("pois")
    if pois is None and isinstance(payload.get("result"), dict):
        pois = payload["result"].get("pois")
    if not isinstance(pois, list):
        raise UpstreamError("上游搜索服务返回结构无法识别")
    return [poi for poi in pois if isinstance(poi, dict)]


def _parse_lng_lat(poi: dict[str, Any]) -> tuple[float, float] | None:
    """提取经纬度，兼容 lonlat（"lng,lat"）与 lon/lat 两种字段。"""
    raw = poi.get("lonlat")
    if isinstance(raw, str) and "," in raw:
        parts = raw.split(",")
        try:
            return float(parts[0]), float(parts[1])
        except (IndexError, ValueError):
            return None
    try:
        return float(poi["lon"]), float(poi["lat"])
    except (KeyError, TypeError, ValueError):
        return None


def _filter_and_normalize(pois: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """按服务区域过滤，去重并归一为 ``{uid, name, address, lng, lat}``。"""
    results: list[dict[str, Any]] = []
    seen: set[str] = set()

    for poi in pois:
        coords = _parse_lng_lat(poi)
        if coords is None:
            continue
        lng, lat = coords
        if not SEARCH_BOUNDS.contains(lng, lat):
            continue

        uid = str(poi.get("uid") or poi.get("id") or f"{lng},{lat}")
        if uid in seen:
            continue
        seen.add(uid)

        results.append(
            {
                "uid": uid,
                "name": str(poi.get("name") or "").strip(),
                "address": str(poi.get("address") or "").strip(),
                "lng": lng,
                "lat": lat,
            }
        )

    return results
