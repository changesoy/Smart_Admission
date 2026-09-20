"""errors.py - 统一错误类型

所有对外错误都归一为 ``ApiError``，由 ``app.py`` 的异常处理器转成统一结构::

    {"ok": false, "error": {"code": "...", "message": "..."}}

这样前端只需要处理一种失败形状。
"""

from __future__ import annotations


class ApiError(Exception):
    """带 HTTP 状态码与稳定错误码的业务异常。"""

    status_code = 500
    code = "INTERNAL_ERROR"

    def __init__(
        self,
        message: str,
        *,
        code: str | None = None,
        status_code: int | None = None,
    ) -> None:
        super().__init__(message)
        self.message = message
        if code is not None:
            self.code = code
        if status_code is not None:
            self.status_code = status_code


class BadRequestError(ApiError):
    status_code = 400
    code = "BAD_REQUEST"


class RateLimitedError(ApiError):
    status_code = 429
    code = "RATE_LIMITED"


class TokenMissingError(ApiError):
    status_code = 503
    code = "TOKEN_MISSING"


class UpstreamError(ApiError):
    status_code = 502
    code = "UPSTREAM_ERROR"


class UpstreamTimeoutError(ApiError):
    status_code = 504
    code = "UPSTREAM_TIMEOUT"
