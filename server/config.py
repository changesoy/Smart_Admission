"""config.py - 服务端配置

集中管理环境变量与常量。所有敏感值（如天地图 token）只从环境变量读取，
``server/`` 目录下不得出现任何真实 token 字面量。

注意: ``SEARCH_BOUNDS`` 必须与前端 ``js/config.js`` 的 ``searchBounds``
保持一致，否则前后端对「结果是否在服务区域内」的判断会漂移。
"""

from __future__ import annotations

import json
import os
from dataclasses import dataclass
from pathlib import Path

ROOT_DIR = Path(__file__).resolve().parent.parent


def _load_dotenv() -> None:
    """本地开发时加载仓库根目录的 .env；未安装 python-dotenv 时静默跳过。"""
    try:
        from dotenv import load_dotenv
    except ImportError:
        return
    load_dotenv(ROOT_DIR / ".env")


_load_dotenv()


def _env_str(name: str, default: str = "") -> str:
    value = os.getenv(name)
    return value.strip() if value else default


def _env_int(name: str, default: int) -> int:
    raw = _env_str(name)
    if not raw:
        return default
    try:
        return int(raw)
    except ValueError:
        return default


def _env_float(name: str, default: float) -> float:
    raw = _env_str(name)
    if not raw:
        return default
    try:
        return float(raw)
    except ValueError:
        return default


def _data_dir() -> Path:
    """数据目录。相对路径按仓库根目录解析，避免受启动时 cwd 影响。"""
    raw = _env_str("DATA_DIR")
    path = Path(raw) if raw else ROOT_DIR / "data"
    return path if path.is_absolute() else ROOT_DIR / path


def _read_package_version() -> str:
    """APP_VERSION 未注入时回退到 package.json，避免上报空版本号。"""
    try:
        with (ROOT_DIR / "package.json").open(encoding="utf-8") as handle:
            return str(json.load(handle).get("version") or "").strip()
    except (OSError, ValueError):
        return ""


@dataclass(frozen=True)
class SearchBounds:
    """联网搜索的服务区域范围（泰山区 + 岱岳区 + 泰山景区）。"""

    min_lng: float
    max_lng: float
    min_lat: float
    max_lat: float

    def contains(self, lng: float, lat: float) -> bool:
        return self.min_lng <= lng <= self.max_lng and self.min_lat <= lat <= self.max_lat

    def as_map_bound(self) -> str:
        """天地图 mapBound 参数格式: minLng,minLat,maxLng,maxLat"""
        return f"{self.min_lng},{self.min_lat},{self.max_lng},{self.max_lat}"


# --- 天地图搜索服务 ---
TIANDITU_SEARCH_URL = "https://api.tianditu.gov.cn/v2/search"
TIANDITU_SEARCH_TK = _env_str("TIANDITU_SEARCH_TK")
SEARCH_KEYWORD_PREFIX = "泰安市"
SEARCH_MAX_QUERY_LENGTH = 50
SEARCH_DEFAULT_COUNT = 10
SEARCH_MAX_COUNT = 20
SEARCH_BOUNDS = SearchBounds(min_lng=116.85, max_lng=117.30, min_lat=35.85, max_lat=36.35)

# --- 流量与缓存控制 ---
SEARCH_TIMEOUT_SECONDS = _env_float("SEARCH_TIMEOUT_SECONDS", 5.0)
SEARCH_CACHE_TTL_SECONDS = _env_float("SEARCH_CACHE_TTL_SECONDS", 60.0)
SEARCH_CACHE_MAX_ENTRIES = 256
SEARCH_RATE_LIMIT_PER_MINUTE = _env_int("SEARCH_RATE_LIMIT_PER_MINUTE", 30)

# --- 版本信息 ---
DATA_DIR = _data_dir()
APP_VERSION = _env_str("APP_VERSION") or _read_package_version()
BUILD_TIME = _env_str("BUILD_TIME") or None
