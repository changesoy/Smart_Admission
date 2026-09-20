"""data_release.py - 版本化数据发布信息读取

读取 ``data/current.json`` 指针与 ``data/releases/<版本>/manifest.json``，
供 ``/api/health`` 与 ``/api/version`` 上报「应用版本 + 数据版本」。

数据版本文件缺失时不抛错，返回空 ``DataRelease``，由调用方如实上报 null，
避免数据目录尚未发布版本时把整个健康检查判死。
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from .config import DATA_DIR

CURRENT_POINTER_NAME = "current.json"
RELEASES_DIR_NAME = "releases"
MANIFEST_NAME = "manifest.json"


@dataclass(frozen=True)
class DataRelease:
    """当前数据发布版本信息；各字段缺失时为 None。"""

    version: str | None = None
    generated_at: str | None = None
    effective_year: int | None = None


def _read_json(path: Path) -> dict[str, Any] | None:
    try:
        with path.open(encoding="utf-8") as handle:
            payload = json.load(handle)
    except (OSError, ValueError):
        return None
    return payload if isinstance(payload, dict) else None


def read_current_release() -> DataRelease:
    """读取当前数据发布版本；任一步缺失都返回空 DataRelease，不抛异常。"""
    pointer = _read_json(DATA_DIR / CURRENT_POINTER_NAME)
    if not pointer:
        return DataRelease()

    version = str(pointer.get("version") or "").strip()
    if not version:
        return DataRelease()

    manifest = _read_json(DATA_DIR / RELEASES_DIR_NAME / version / MANIFEST_NAME)
    if not manifest:
        # 指针存在但 manifest 缺失:仍上报版本号，便于定位数据发布问题
        return DataRelease(version=version)

    generated_at = str(manifest.get("generatedAt") or "").strip() or None
    effective_year_raw = manifest.get("effectiveYear")
    effective_year = effective_year_raw if isinstance(effective_year_raw, int) else None

    return DataRelease(
        version=version,
        generated_at=generated_at,
        effective_year=effective_year,
    )
