"""app.py - FastAPI 应用入口

Backend Lite 的职责严格限制为: health / version / 第三方搜索代理。
明确不负责 Turf 点面判断、学区查询、返回学校与政策数据、用户账号、管理后台。

本地启动（端口需与 vite.config.js 的 API_TARGET 一致）::

    .venv\\Scripts\\python.exe -m uvicorn server.app:app --port 8010 --reload

生产环境由反向代理把 /api 转发到本进程。
"""

from __future__ import annotations

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

from .config import APP_VERSION
from .errors import ApiError
from .routes import health, search, version

# 非业务异常（路由不存在、方法不允许等）同样要收敛成统一结构
_HTTP_ERRORS = {
    404: ("NOT_FOUND", "接口不存在"),
    405: ("METHOD_NOT_ALLOWED", "请求方法不允许"),
}

app = FastAPI(
    title="Smart Admission Backend Lite",
    version=APP_VERSION or "0.0.0",
    description="智慧入学门户的服务端最小能力: health / version / search 代理",
)


def _error_response(
    status_code: int,
    code: str,
    message: str,
    headers: dict[str, str] | None = None,
) -> JSONResponse:
    return JSONResponse(
        status_code=status_code,
        content={"ok": False, "error": {"code": code, "message": message}},
        headers=headers,
    )


@app.exception_handler(ApiError)
async def handle_api_error(_: Request, exc: ApiError) -> JSONResponse:
    headers = {"Retry-After": "60"} if exc.code == "RATE_LIMITED" else None
    return _error_response(exc.status_code, exc.code, exc.message, headers)


@app.exception_handler(StarletteHTTPException)
async def handle_http_exception(_: Request, exc: StarletteHTTPException) -> JSONResponse:
    code, message = _HTTP_ERRORS.get(
        exc.status_code,
        ("HTTP_ERROR", str(exc.detail) if exc.detail else "请求失败"),
    )
    return _error_response(exc.status_code, code, message)


@app.exception_handler(RequestValidationError)
async def handle_request_validation_error(
    _: Request, exc: RequestValidationError
) -> JSONResponse:
    """FastAPI 默认的 422 结构与本服务不统一，这里收敛为 BAD_REQUEST。"""
    errors = exc.errors()
    location = ".".join(str(part) for part in errors[0].get("loc", [])) if errors else ""
    field = location or "请求参数"
    return _error_response(400, "BAD_REQUEST", f"请求参数不合法: {field}")


@app.exception_handler(Exception)
async def handle_unexpected_error(_: Request, exc: Exception) -> JSONResponse:
    """兜底，保证任何未预期异常也返回统一结构而不是默认 HTML/纯文本。"""
    return _error_response(500, "INTERNAL_ERROR", "服务端内部错误")


app.include_router(health.router, prefix="/api", tags=["health"])
app.include_router(version.router, prefix="/api", tags=["version"])
app.include_router(search.router, prefix="/api", tags=["search"])
