"""health.py - GET /api/health

用于判断后端进程是否存活，并顺带上报当前数据版本。
数据版本缺失不视为不健康，只是如实上报 null。
"""

from __future__ import annotations

import time

from fastapi import APIRouter

from ..data_release import read_current_release

router = APIRouter()

_STARTED_AT = time.monotonic()


@router.get("/health")
def get_health() -> dict:
    release = read_current_release()
    return {
        "ok": True,
        "status": "healthy",
        "uptimeSeconds": int(time.monotonic() - _STARTED_AT),
        "dataVersion": release.version,
    }
