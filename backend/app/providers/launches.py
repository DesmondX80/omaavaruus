from datetime import datetime, timezone
from typing import Any

import httpx
from fastapi import HTTPException

from app.cache import cache
from app.config import get_settings
from app.models import Launch, LaunchBoard
from app.providers.http import get_client


def _name(value: Any) -> str:
    """Launch Library 2 palauttaa list-moodissa osan kentistä merkkijonoina,
    normal-moodissa dictinä. Tämä käsittelee molemmat."""
    if isinstance(value, dict):
        return str(value.get("name") or value.get("abbrev") or "")
    if isinstance(value, str):
        return value
    return ""


def _rocket(row: dict) -> str:
    rocket = row.get("rocket")
    if isinstance(rocket, dict):
        cfg = rocket.get("configuration")
        if isinstance(cfg, dict):
            return str(cfg.get("full_name") or cfg.get("name") or "")
        return _name(cfg)
    return _name(rocket)


def _parse_net(value: Any) -> datetime | None:
    if not value:
        return None
    try:
        return datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except ValueError:
        return None


def _to_launch(row: dict) -> Launch:
    status = row.get("status")
    pad = row.get("pad") if isinstance(row.get("pad"), dict) else {}
    location = _name(pad.get("location")) or _name(row.get("location"))
    mission = row.get("mission")
    net = _parse_net(row.get("net"))

    return Launch(
        id=str(row.get("id", "")),
        name=str(row.get("name") or "Tuntematon laukaisu"),
        net=net,
        status=_name(status),
        status_abbrev=str(status.get("abbrev") or "") if isinstance(status, dict) else "",
        provider=_name(row.get("launch_service_provider")),
        rocket=_rocket(row),
        pad=str(pad.get("name") or ""),
        location=location,
        mission=_name(mission) or None,
        image=row.get("image") if isinstance(row.get("image"), str) else None,
        stream_url=None,
        seconds_to_launch=int((net - datetime.now(timezone.utc)).total_seconds()) if net else None,
    )


async def get_launches() -> LaunchBoard:
    s = get_settings()

    async def build() -> LaunchBoard:
        params = {
            "format": "json",
            "mode": "list",
            "limit": s.launch_limit,
            "hide_recent_previous": "true",
        }
        headers = {"Authorization": f"Token {s.ll2_token}"} if s.ll2_token else {}
        try:
            resp = await get_client().get(f"{s.ll2_base}/launches/upcoming/", params=params, headers=headers)
            resp.raise_for_status()
        except httpx.HTTPStatusError as exc:
            code = exc.response.status_code
            hint = "julkinen kiintiö täynnä – aseta OMAVARUUS_LL2_TOKEN" if code in (429, 403) else "yllättävä vastaus"
            raise HTTPException(status_code=503, detail=f"Launch Library 2: HTTP {code} ({hint})") from exc
        except httpx.HTTPError as exc:
            raise HTTPException(status_code=503, detail=f"Launch Library 2 ei vastannut: {exc}") from exc

        payload = resp.json()
        rows = payload.get("results", []) if isinstance(payload, dict) else []
        launches: list[Launch] = []
        for row in rows:
            if not isinstance(row, dict):
                continue
            try:
                launches.append(_to_launch(row))
            except Exception:
                continue

        launches.sort(key=lambda l: l.net or datetime.max.replace(tzinfo=timezone.utc))
        return LaunchBoard(
            updated=datetime.now(timezone.utc),
            count=int(payload.get("count", len(launches))) if isinstance(payload, dict) else len(launches),
            next_launch=launches[0] if launches else None,
            results=launches,
        )

    return await cache.get_or_set("launches", s.ttl_launches, build)
