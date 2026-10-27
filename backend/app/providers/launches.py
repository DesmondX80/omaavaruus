import asyncio
import math
import time
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
from urllib.parse import quote
import httpx
from fastapi import HTTPException
from app.models import Launch, LaunchBoard
from app.providers.http import get_client

URL = 'https://fdo.rocketlaunch.live/json/launches/next/5'
_lock = asyncio.Lock()
_board = None
_next = 0.0
_error = None

def retry_seconds(value):
    try:
        return max(1, math.ceil(float(value)))
    except (TypeError, ValueError, OverflowError):
        try:
            date = parsedate_to_datetime(value)
            if date.tzinfo is None:
                date = date.replace(tzinfo=timezone.utc)
            return max(1, math.ceil((date - datetime.now(timezone.utc)).total_seconds()))
        except (TypeError, ValueError, OverflowError, AttributeError):
            return 3600

def parse_launch(row):
    raw = row.get('t0')
    net = datetime.fromisoformat(raw.replace('Z', '+00:00')) if raw else None
    if net and net.tzinfo is None:
        net = net.replace(tzinfo=timezone.utc)
    pad = row.get('pad') or {}
    slug = row.get('slug')
    return Launch(
        id=str(row['id']), name=row['name'], net=net,
        status='Suunniteltu' if net else 'Aika tarkentuu: ' + str(row.get('date_str') or 'ei tiedossa'),
        provider=(row.get('provider') or {}).get('name', ''),
        rocket=(row.get('vehicle') or {}).get('name', ''),
        pad=pad.get('name', ''), location=(pad.get('location') or {}).get('name', ''),
        stream_url='https://www.rocketlaunch.live/launch/' + quote(slug, safe='') if isinstance(slug, str) and slug else None,
        seconds_to_launch=int((net - datetime.now(timezone.utc)).total_seconds()) if net else None,
    )

async def get_launches() -> LaunchBoard:
    global _board, _next, _error
    async with _lock:
        remaining = math.ceil(_next - time.monotonic())
        if remaining > 0:
            if _error:
                raise HTTPException(503, detail=f'{_error} Uusi haku {remaining} sekunnin kuluttua.', headers={'Retry-After': str(remaining)})
            return _board
        delay = 60
        try:
            response = await get_client().get(URL)
            if response.status_code == 429:
                delay = retry_seconds(response.headers.get('Retry-After'))
            response.raise_for_status()
            rows = response.json()['result']
            if not isinstance(rows, list):
                raise ValueError('Invalid launch list')
            launches = [parse_launch(row) for row in rows]
            _board = LaunchBoard(updated=datetime.now(timezone.utc), count=len(launches), next_launch=launches[0] if launches else None, results=launches)
        except (httpx.HTTPError, ValueError, KeyError, TypeError, AttributeError) as exc:
            _error = f'RocketLaunch.Live HTTP {exc.response.status_code}.' if isinstance(exc, httpx.HTTPStatusError) else 'Laukaisudatan haku epäonnistui.'
            _next = time.monotonic() + delay
            raise HTTPException(503, detail=f'{_error} Uusi haku {delay} sekunnin kuluttua.', headers={'Retry-After': str(delay)}) from exc
        _error = None
        _next = time.monotonic() + 600
        return _board
