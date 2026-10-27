import asyncio
import math
import time
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime

import httpx
from fastapi import HTTPException

from app.config import get_settings
from app.models import Launch, LaunchBoard
from app.providers.http import get_client

_lock = asyncio.Lock()
_board = None
_next_attempt = 0.0
_error = None


def retry_seconds(value, default=3600):
    if value is None:
        return default
    try:
        return max(1, math.ceil(float(value)))
    except (ValueError, TypeError, OverflowError):
        try:
            date = parsedate_to_datetime(value)
            if date.tzinfo is None:
                date = date.replace(tzinfo=timezone.utc)
            return max(1, math.ceil((date - datetime.now(timezone.utc)).total_seconds()))
        except (ValueError, TypeError, OverflowError):
            return default


def name(value):
    if isinstance(value, dict):
        return str(value.get('name') or value.get('abbrev') or '')
    return value if isinstance(value, str) else ''


def parse_launch(row):
    raw = row.get('net')
    net = datetime.fromisoformat(raw.replace('Z', '+00:00')) if raw else None
    if net and net.tzinfo is None:
        net = net.replace(tzinfo=timezone.utc)
    pad = row.get('pad')
    pad = pad if isinstance(pad, dict) else {}
    rocket = row.get('rocket')
    cfg = rocket.get('configuration') if isinstance(rocket, dict) else rocket
    rocket_name = str(cfg.get('full_name') or cfg.get('name') or '') if isinstance(cfg, dict) else name(cfg)
    status = row.get('status')
    return Launch(
        id=str(row.get('id', '')), name=str(row.get('name') or 'Tuntematon laukaisu'),
        net=net, status=name(status),
        status_abbrev=str(status.get('abbrev') or '') if isinstance(status, dict) else '',
        provider=name(row.get('launch_service_provider')), rocket=rocket_name,
        pad=name(pad), location=name(pad.get('location')) or name(row.get('location')),
        mission=name(row.get('mission')) or None,
        image=row.get('image') if isinstance(row.get('image'), str) else None,
        seconds_to_launch=int((net - datetime.now(timezone.utc)).total_seconds()) if net else None,
    )


async def get_launches() -> LaunchBoard:
    global _board, _next_attempt, _error
    async with _lock:
        remaining = math.ceil(_next_attempt - time.monotonic())
        if remaining > 0:
            if _error:
                raise HTTPException(503, detail=f'{_error} Uusi yritys {remaining} sekunnin kuluttua.', headers={'Retry-After': str(remaining)})
            return _board
        s = get_settings()
        delay = 60
        try:
            response = await get_client().get(
                f'{s.ll2_base}/launches/upcoming/',
                params={'format': 'json', 'mode': 'list', 'limit': s.launch_limit, 'hide_recent_previous': 'true'},
                headers={'Authorization': f'Token {s.ll2_token}'} if s.ll2_token else {},
            )
            delay = retry_seconds(response.headers.get('Retry-After'), 3600 if response.status_code == 429 else 60)
            response.raise_for_status()
            payload = response.json()
            launches = [parse_launch(row) for row in payload['results']]
            launches.sort(key=lambda item: item.net or datetime.max.replace(tzinfo=timezone.utc))
            _board = LaunchBoard(updated=datetime.now(timezone.utc), count=payload.get('count', len(launches)), next_launch=launches[0] if launches else None, results=launches)
        except (httpx.HTTPError, ValueError, KeyError, TypeError) as exc:
            _error = f'Launch Library 2: HTTP {exc.response.status_code}' if isinstance(exc, httpx.HTTPStatusError) else 'Laukaisudataa ei saatu tietolähteestä.'
            _next_attempt = time.monotonic() + delay
            raise HTTPException(503, detail=f'{_error} Uusi yritys {delay} sekunnin kuluttua.', headers={'Retry-After': str(delay)}) from exc
        _error = None
        _next_attempt = time.monotonic() + max(300, s.ttl_launches)
        return _board
