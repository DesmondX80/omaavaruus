"""Taivaankartta: planeetat Skyfieldillä, kirkkaat tähdet staattisesta luettelosta."""
from __future__ import annotations

import asyncio
from datetime import datetime, timezone
from functools import lru_cache

from fastapi import HTTPException

from app.cache import cache
from app.config import get_settings
from app.models import Observer, SkyChart, SkyObject

# (nimi, RA tunteina, Dec astetta, magnitudi)
BRIGHT_STARS: list[tuple[str, float, float, float]] = [
    ("Sirius", 6.7525, -16.716, -1.44), ("Canopus", 6.3992, -52.696, -0.62),
    ("Arcturus", 14.2610, 19.182, -0.05), ("Vega", 18.6156, 38.784, 0.03),
    ("Capella", 5.2782, 45.998, 0.08), ("Rigel", 5.2423, -8.202, 0.13),
    ("Procyon", 7.6550, 5.225, 0.34), ("Betelgeuse", 5.9195, 7.407, 0.50),
    ("Achernar", 1.6286, -57.237, 0.46), ("Altair", 19.8464, 8.868, 0.77),
    ("Aldebaran", 4.5987, 16.509, 0.85), ("Antares", 16.4901, -26.432, 1.09),
    ("Spica", 13.4199, -11.161, 0.97), ("Pollux", 7.7553, 28.026, 1.14),
    ("Fomalhaut", 22.9608, -29.622, 1.16), ("Deneb", 20.6905, 45.280, 1.25),
    ("Regulus", 10.1395, 11.967, 1.35), ("Castor", 7.5767, 31.888, 1.58),
    ("Polaris", 2.5303, 89.264, 1.98), ("Dubhe", 11.0621, 61.751, 1.79),
    ("Alioth", 12.9005, 55.960, 1.77), ("Alkaid", 13.7923, 49.313, 1.86),
    ("Mizar", 13.3987, 54.925, 2.23), ("Schedar", 0.6751, 56.537, 2.24),
    ("Caph", 0.1529, 59.150, 2.27), ("Ruchbah", 1.4303, 60.235, 2.66),
    ("Mirfak", 3.4054, 49.861, 1.79), ("Algol", 3.1361, 40.956, 2.12),
    ("Alnitak", 5.6793, -1.943, 1.77), ("Alnilam", 5.6036, -1.202, 1.69),
    ("Mintaka", 5.5334, -0.299, 2.25), ("Bellatrix", 5.4188, 6.350, 1.64),
    ("Alhena", 6.6285, 16.399, 1.93), ("Wezen", 7.1399, -26.393, 1.83),
    ("Adhara", 6.9770, -28.972, 1.50), ("Suhail", 9.1333, -43.433, 2.21),
    ("Alphard", 9.4597, -8.659, 1.98), ("Algieba", 10.3329, 19.841, 2.08),
    ("Denebola", 11.8177, 14.572, 2.14), ("Gienah", 12.2634, -17.542, 2.59),
    ("Kochab", 14.8451, 74.156, 2.08), ("Alphecca", 15.5781, 26.715, 2.22),
    ("Rasalhague", 17.5822, 12.560, 2.08), ("Nunki", 18.9211, -26.297, 2.05),
    ("Peacock", 20.4275, -56.735, 1.94), ("Enif", 21.7364, 9.875, 2.39),
    ("Markab", 23.0794, 15.205, 2.48), ("Scheat", 23.0629, 28.083, 2.42),
    ("Alpheratz", 0.1398, 29.091, 2.06), ("Mirach", 1.1622, 35.620, 2.06),
    ("Hamal", 2.1196, 23.463, 2.00), ("Menkar", 3.0379, 4.090, 2.53),
    ("Saiph", 5.7959, -9.670, 2.06), ("Sadr", 20.3707, 40.257, 2.23),
]

PLANETS = {
    "Merkurius": "mercury", "Venus": "venus", "Mars": "mars", "Jupiter": "jupiter",
    "Saturnus": "saturn", "Uranus": "uranus", "Neptunus": "neptune",
}

MOON_PHASES = [(0, "Uusi kuu"), (45, "Kasvava sirppi"), (90, "Ensimmäinen neljännes"),
               (135, "Kasvava kupera"), (180, "Täysikuu"), (225, "Vähenevä kupera"),
               (270, "Viimeinen neljännes"), (315, "Vähenevä sirppi")]


@lru_cache
def _skyfield():
    """Ladataan efemeridi ja kello kerran prosessin elinaikana."""
    from skyfield.api import load

    eph = load("de421.bsp")
    ts = load.timescale()
    return eph, ts


def moon_phase_name(deg: float) -> str:
    best = min(MOON_PHASES, key=lambda p: abs(((deg - p[0] + 180) % 360) - 180))
    return best[1]


def _build(lat: float, lon: float, elev: float, at: datetime, place: str) -> SkyChart:
    from skyfield import almanac
    from skyfield.api import Star, wgs84

    eph, ts = _skyfield()
    t = ts.from_datetime(at.astimezone(timezone.utc))
    observer = eph["earth"] + wgs84.latlon(lat, lon, elevation_m=elev)

    objects: list[SkyObject] = []

    def add_solar(name: str, body_key: str, kind: str) -> float:
        alt, az, _ = observer.at(t).observe(eph[body_key]).apparent().altaz()
        objects.append(SkyObject(name=name, kind=kind, alt=round(alt.degrees, 2), az=round(az.degrees, 2)))
        return alt.degrees

    sun_alt = add_solar("Aurinko", "sun", "sun")
    add_solar("Kuu", "moon", "moon")
    for name, key in PLANETS.items():
        add_solar(name, key, "planet")

    for name, ra_h, dec_d, mag in BRIGHT_STARS:
        try:
            alt, az, _ = observer.at(t).observe(Star(ra_hours=ra_h, dec_degrees=dec_d)).apparent().altaz()
            objects.append(
                SkyObject(name=name, kind="star", alt=round(alt.degrees, 2), az=round(az.degrees, 2), magnitude=mag)
            )
        except Exception:
            continue

    phase_deg = float(almanac.moon_phase(eph, t).degrees) % 360
    objects.sort(key=lambda o: (o.kind == "star", -o.alt))

    return SkyChart(
        at=at.astimezone(timezone.utc),
        observer=Observer(lat=lat, lon=lon, elevation_m=elev, place=place),
        sun_alt=round(sun_alt, 2),
        is_dark=sun_alt < -6,
        moon_phase_deg=round(phase_deg, 1),
        moon_phase_name=moon_phase_name(phase_deg),
        objects=objects,
        note="Korkeus horisontista asteina, atsimuutti myötäpäivään pohjoisesta.",
    )


async def _build_async(lat: float, lon: float, elev: float, at: datetime, place: str) -> SkyChart:
    return await asyncio.to_thread(_build, lat, lon, elev, at, place)


async def get_sky_chart(lat: float, lon: float, at: datetime, place: str | None = None) -> SkyChart:
    s = get_settings()
    place = place or s.default_place
    key = f"sky:{lat:.3f}:{lon:.3f}:{at.strftime('%Y%m%d%H%M')}"
    try:
        return await cache.get_or_set(
            key, s.ttl_sky, lambda: _build_async(lat, lon, s.default_elevation_m, at, place)
        )
    except HTTPException:
        raise
    except Exception as exc:  # kerrotaan syy selkeästi 500:n sijaan
        raise HTTPException(
            status_code=503,
            detail=f"Taivaankartan laskenta epäonnistui: {type(exc).__name__}: {exc}",
        ) from exc
