import httpx

from app.config import get_settings

_client: httpx.AsyncClient | None = None


def get_client() -> httpx.AsyncClient:
    global _client
    if _client is None:
        _client = httpx.AsyncClient(timeout=get_settings().http_timeout_s, headers={"User-Agent": "OmaAvaruus/0.1"})
    return _client


async def close_client() -> None:
    global _client
    if _client is not None:
        await _client.aclose()
        _client = None


def as_records(payload: object) -> list[dict]:
    """SWPC palauttaa sekä lista-dictinä että [otsikot, ...rivit] -muodossa."""
    if not isinstance(payload, list) or not payload:
        return []
    if isinstance(payload[0], dict):
        return [row for row in payload if isinstance(row, dict)]
    header = [str(h).lower() for h in payload[0]]
    return [dict(zip(header, row)) for row in payload[1:] if isinstance(row, list)]
