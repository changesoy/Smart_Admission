"""version.py - GET /api/version

同时上报应用版本与数据版本，供发布流程核对
「线上跑的是哪个构建 + 哪一版数据」。
"""

from __future__ import annotations

from fastapi import APIRouter

from ..config import APP_VERSION, BUILD_TIME
from ..data_release import read_current_release

router = APIRouter()


@router.get("/version")
def get_version() -> dict:
    release = read_current_release()
    return {
        "ok": True,
        "appVersion": APP_VERSION,
        "buildTime": BUILD_TIME,
        "dataVersion": release.version,
        "dataGeneratedAt": release.generated_at,
        "dataEffectiveYear": release.effective_year,
    }
