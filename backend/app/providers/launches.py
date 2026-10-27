from datetime import datetime, timezone

from app.cache import cache
from app.config import get_settings
from app.models import Launch, LaunchBoard
from app.providers.http import get_client


def _to_launch(row: dict) -> Launch:
    status = row.get("status") or {}
    pad = row.get("pad") or {}
    location = (pad.get("location") or {}).get("name", "")
    provider = (row.get("launch_service_provider") or {}).get("name", "")
    rocket = ((row.get("rocket") or {}).get("configuration") or {}).get("full_name", "")
    mission = (row.get("mission") or {}).get("name")
    net_raw = row.get("net")
    net = datetime.fromisoformat(net_raw.replace("Z", "+00:00")) if net_raw else None
    secs = int((net - datetime.now(timezone.utc)).total_seconds()) if net else None

    return Launch(
        id=str(row.get("id", "")),
        name=row.get("name", "Tuntematon laukaisu"),
        net=net,
        status=status.get("name", ""),
        status_abbrev=status.get("abbrev", ""),
        provider=provider,
        rocket=rocket,
        pad=pad.get("name", ""),
        location=location,
        mission=mission,
        image=row.get("image"),
        stream_url=(row.get("vidURLs") or [{}])[0].get("url") if row.get("vidURLs") else None,
        seconds_to_launch=secs,
    )


async def get_launches() -> LaunchBoard:
    s = get_settings()

    async def build() -> LaunchBoard:
        params = {"format": "json", "mode": "list", "limit": s.launch_limit, "hide_recent_previous": "true"}
        headers = {"Authorization": f"Token {s.ll2_token}"} if s.ll2_token else {}
        resp = await get_client().get(f"{s.ll2_base}/launches/upcoming/", params=params, headers=headers)
        resp.raise_for_status()
        payload = resp.json()
        launches = [_to_launch(row) for row in payload.get("results", [])]
        launches.sort(key=lambda l: l.net or datetime.max.replace(tzinfo=timezone.utc))
        return LaunchBoard(
            updated=datetime.now(timezone.utc),
            count=payload.get("count", len(launches)),
            next_launch=launches[0] if launches else None,
            results=launches,
        )

    return await cache.get_or_set("launches", s.ttl_launches, build)
