"""ratelimit.py - 进程内简单限流

按客户端标识做滑动窗口计数，只用于保护上游第三方接口。
刻意不引入 Redis: 当前是同源单实例部署，精确的分布式限流没有业务价值。
"""

from __future__ import annotations

import time
from collections import deque

DEFAULT_WINDOW_SECONDS = 60.0
# 超过该条目数时清理过期键，防止长期运行后字典无限增长
COMPACT_THRESHOLD = 1024


class RateLimiter:
    """固定窗口长度的滑动计数限流器。"""

    def __init__(self, limit: int, window_seconds: float = DEFAULT_WINDOW_SECONDS) -> None:
        self._limit = limit
        self._window = window_seconds
        self._hits: dict[str, deque[float]] = {}

    def allow(self, key: str) -> bool:
        """记录一次访问并返回是否放行。"""
        now = time.monotonic()
        hits = self._hits.get(key)
        if hits is None:
            hits = deque()
            self._hits[key] = hits

        while hits and now - hits[0] > self._window:
            hits.popleft()

        if len(hits) >= self._limit:
            return False

        hits.append(now)
        self._compact(now)
        return True

    def _compact(self, now: float) -> None:
        """丢弃已完全滑出窗口的键，保持内存有界。"""
        if len(self._hits) <= COMPACT_THRESHOLD:
            return
        for key, hits in list(self._hits.items()):
            if not hits or now - hits[-1] > self._window:
                del self._hits[key]
