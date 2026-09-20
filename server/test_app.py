"""test_app.py - 应用最小验证脚本（无第三方测试框架依赖）

覆盖: API 路由可用 / 静态挂载生效 / 数据文件可访问 / API 优先级不被静态挂载
影响 / dist 缺失时降级为仅 API。

用法::

    .venv\\Scripts\\python.exe -m server.test_app

依赖: fastapi.testclient（基于 httpx，均已在 requirements.txt 中）。
"""

from __future__ import annotations

from pathlib import Path

from fastapi import FastAPI
from fastapi.testclient import TestClient

from .app import _DIST_DIR, _mount_static, app
from .config import ROOT_DIR

_SKIPPED: list[str] = []


def _check(label: str, cond: bool, detail: str = "") -> None:
    print(f"  {'✅' if cond else '❌'} {label}" + (f"  ({detail})" if detail else ""))
    if not cond:
        raise SystemExit(1)


def _skip(label: str, reason: str) -> None:
    print(f"  ⏭️  {label}  (跳过: {reason})")
    _SKIPPED.append(label)


def _assert_api(client: TestClient) -> None:
    r = client.get("/api/health")
    _check("GET /api/health -> 200", r.status_code == 200, f"status={r.status_code}")
    _check("  body.ok=true", r.json().get("ok") is True)

    r = client.get("/api/version")
    _check("GET /api/version -> 200", r.status_code == 200, f"status={r.status_code}")
    body = r.json()
    _check("  body.ok=true", body.get("ok") is True)
    _check("  body.dataVersion 非空", bool(body.get("dataVersion")), str(body.get("dataVersion")))

    r = client.get("/api/search")  # 缺 q -> 应被 API 路由先匹配并收敛为 400
    _check("GET /api/search(缺参) -> 400", r.status_code == 400, f"status={r.status_code}")
    _check("  body.error.code=BAD_REQUEST", r.json().get("error", {}).get("code") == "BAD_REQUEST")


def _assert_static(client: TestClient) -> None:
    r = client.get("/")
    _check("GET / -> 200 HTML", r.status_code == 200, f"status={r.status_code}")
    _check("  content-type=text/html", r.headers.get("content-type", "").startswith("text/html"),
           r.headers.get("content-type", ""))
    _check("  body 含 <!doctype", r.text.lstrip().lower().startswith("<!doctype"),
           r.text[:30].replace("\n", " "))

    r = client.get("/data/current.json")
    _check("GET /data/current.json -> 200", r.status_code == 200, f"status={r.status_code}")
    pointer_file = ROOT_DIR / "data" / "current.json"
    if pointer_file.is_file():
        expected = __import__("json").loads(pointer_file.read_text(encoding="utf-8")).get("version")
        _check("  version 与 data/current.json 一致", r.json().get("version") == expected,
               f"got={r.json().get('version')} want={expected}")

    r = client.get("/docs")
    _check("GET /docs -> 200（默认路由未被静态挂载吞掉）", r.status_code == 200,
           f"status={r.status_code}")

    r = client.get("/no-such-static-file-xyz")
    _check("GET 不存在的静态文件 -> 404（统一错误结构）", r.status_code == 404,
           f"status={r.status_code}")
    _check("  body.error.code=NOT_FOUND",
           r.json().get("error", {}).get("code") == "NOT_FOUND")


def _assert_mount_skip() -> None:
    bare = FastAPI(title="bare")
    before = len(bare.routes)
    _mount_static(bare, Path("Z:/definitely/not/a/dir"))
    _check("dist 不存在时 _mount_static 不挂载", len(bare.routes) == before,
           f"routes {before} -> {len(bare.routes)}")


def main() -> None:
    print("== server/app 最小验证 ==")

    _assert_mount_skip()

    dist_ok = _DIST_DIR.is_dir()
    if not dist_ok:
        _skip("静态挂载断言", f"dist/ 不存在（{_DIST_DIR}），请先 npm run build")

    client = TestClient(app)
    _assert_api(client)
    if dist_ok:
        _assert_static(client)

    if _SKIPPED:
        print(f"\n跳过 {len(_SKIPPED)} 项: {', '.join(_SKIPPED)}")
    print("\n✅ 全部通过")


if __name__ == "__main__":
    main()
