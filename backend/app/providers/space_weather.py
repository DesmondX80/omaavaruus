from datetime import datetime, timezone

from app.cache import cache
from app.config import get_settings
from app.models import KpPoint, SpaceWeather
from app.providers.http import as_records, get_client

G_LABELS = {
    0: "Rauhallinen",
    1: "G1 – heikko myrsky",
    2: "G2 – kohtalainen myrsky",
    3: "G3 – voimakas myrsky",
    4: "G4 – vakava myrsky",
    5: "G5 – äärimmäinen myrsky",
}


def kp_to_g_scale(kp: float) -> int:
    """NOAA G-asteikko (geomagneettinen myrsky) Kp-arvosta."""
    if kp >= 9:
        return 5
    if kp >= 8:
        return 4
    if kp >= 7:
        return 3
    if kp >= 6:
        return 2
    if kp >= 5:
        return 1
    return 0


def aurora_chance(kp: float, lat: float) -> str:
    """Karkea arvio revontulien näkyvyydestä annetulla leveysasteella."""
    if lat < 55:
        return "Epätodennäköinen"
    need = 9 - (lat - 55) / 1.6
    if kp >= need + 1.5:
        return "Erittäin hyvä"
    if kp >= need:
        return "Hyvä"
    if kp >= need - 1.5:
        return "Mahdollinen"
    return "Epätodennäköinen"


def _parse_ts(value: str) -> datetime:
    return datetime.fromisoformat(str(value).replace("Z", "+00:00")).replace(tzinfo=timezone.utc)


async def _fetch(url: str) -> object:
    resp = await get_client().get(url)
    resp.raise_for_status()
    return resp.json()


async def _kp_history() -> list[KpPoint]:
    rows = as_records(await _fetch(f"{get_settings().swpc_base}/products/noaa-planetary-k-index.json"))
    points = []
    for row in rows[-24:]:
        kp = float(row.get("kp", row.get("Kp", 0)))
        points.append(KpPoint(time_tag=_parse_ts(row["time_tag"]), kp=kp, kind="observed", g_scale=kp_to_g_scale(kp)))
    return points


async def _kp_forecast() -> list[KpPoint]:
    rows = as_records(await _fetch(f"{get_settings().swpc_base}/products/noaa-planetary-k-index-forecast.json"))
    points = []
    for row in rows[:24]:
        kp = float(row.get("kp", 0))
        kind = str(row.get("observed", "predicted"))
        points.append(KpPoint(time_tag=_parse_ts(row["time_tag"]), kp=kp, kind=kind, g_scale=kp_to_g_scale(kp)))
    return points


async def _solar_wind() -> tuple[float | None, float | None, float | None]:
    speed = bz = bt = None
    try:
        rows = as_records(await _fetch(f"{get_settings().swpc_base}/products/summary/solar-wind-speed.json"))
        if rows:
            speed = float(rows[-1].get("windspeed") or rows[-1].get("wind_speed") or 0) or None
    except Exception:
        pass
    try:
        rows = as_records(await _fetch(f"{get_settings().swpc_base}/products/summary/solar-wind-mag-field.json"))
        if rows:
            bz = float(rows[-1].get("bz") or 0)
            bt = float(rows[-1].get("bt") or 0) or None
    except Exception:
        pass
    return speed, bz, bt


async def _alerts() -> list[str]:
    try:
        rows = as_records(await _fetch(f"{get_settings().swpc_base}/products/alerts.json"))
    except Exception:
        return []
    messages = []
    for row in rows[:5]:
        msg = " ".join(str(row.get("message", "")).split())
        if msg:
            messages.append(msg[:280])
    return messages


async def get_space_weather(lat: float) -> SpaceWeather:
    async def build() -> SpaceWeather:
        history = await _kp_history()
        forecast = await _kp_forecast()
        speed, bz, bt = await _solar_wind()
        alerts = await _alerts()
        kp_now = history[-1].kp if history else 0.0
        g = kp_to_g_scale(kp_now)
        return SpaceWeather(
            updated=datetime.now(timezone.utc),
            kp_now=kp_now,
            g_scale=g,
            g_label=G_LABELS[g],
            kp_history=history,
            kp_forecast=forecast,
            solar_wind_speed_kms=speed,
            bz_nt=bz,
            bt_nt=bt,
            aurora_chance=aurora_chance(kp_now, lat),
            alerts=alerts,
            sources=[
                f"{get_settings().swpc_base}/products/noaa-planetary-k-index.json",
                "https://www.swpc.noaa.gov/products/planetary-k-index",
            ],
        )

    return await cache.get_or_set(f"spaceweather:{lat:.1f}", get_settings().ttl_space_weather, build)
