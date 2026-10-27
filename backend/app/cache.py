import asyncio
import time
from collections.abc import Awaitable, Callable
from typing import Any


class TTLCache:
    """Pieni asynkroninen TTL-välimuisti ulkoisten API-kutsujen suojaksi."""

    def __init__(self) -> None:
        self._store: dict[str, tuple[float, Any]] = {}
        self._locks: dict[str, asyncio.Lock] = {}

    async def get_or_set(self, key: str, ttl: int, factory: Callable[[], Awaitable[Any]]) -> Any:
        now = time.monotonic()
        hit = self._store.get(key)
        if hit and hit[0] > now:
            return hit[1]

        lock = self._locks.setdefault(key, asyncio.Lock())
        async with lock:
            hit = self._store.get(key)
            if hit and hit[0] > time.monotonic():
                return hit[1]
            value = await factory()
            self._store[key] = (time.monotonic() + ttl, value)
            return value


cache = TTLCache()
