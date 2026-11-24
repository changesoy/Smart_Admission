"""search.py - GET /api/search

前端不直接拼装第三方搜索 URL，统一经由本接口代理，
以便在服务端集中处理 token、超时、限流、缓存与错误归一。

边界: 地图瓦片不经过这里，仍由浏览器直连天地图 Tile Server。
"""

from __future__ import annotations

from fastapi import APIRouter, Query, Request

from ..config import SEARCH_BOUNDS, SEARCH_RATE_LIMIT_PER_MINUTE
from ..errors import RateLimitedError
from ..services.ratelimit import RateLimiter
from ..services.tianditu import normalize_count, normalize_query, search_pois

router = APIRouter()

_limiter = RateLimiter(SEARCH_RATE_LIMIT_PER_MINUTE)


def _client_key(request: Request) -> str:
    """限流用的客户端标识。

    当前部署形态是同源直连，因此不采信 X-Forwarded-For；
    若后续放在反向代理之后，需要按可信代理链再调整。
    """
    return request.client.host if request.client else "unknown"


@router.get("/search")
async def search(
    request: Request,
    q: str | None = Query(default=None, description="地址 / POI 关键词"),
    count: str | None = Query(default=None, description="返回条数，1-20"),
) -> dict:
    if not _limiter.allow(_client_key(request)):
        raise RateLimitedError("请求过于频繁，请稍后重试")

    query = normalize_query(q)
    limit = normalize_count(count)
    results, cached = await search_pois(query, limit)

    return {
        "ok": True,
        "query": query,
        "count": len(results),
        "cached": cached,
        "bounds": {
            "minLng": SEARCH_BOUNDS.min_lng,
            "maxLng": SEARCH_BOUNDS.max_lng,
            "minLat": SEARCH_BOUNDS.min_lat,
            "maxLat": SEARCH_BOUNDS.max_lat,
        },
        "results": results,
    }
