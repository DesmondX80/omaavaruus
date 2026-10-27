from datetime import datetime

from pydantic import BaseModel, Field


class KpPoint(BaseModel):
    time_tag: datetime
    kp: float
    kind: str = Field("observed", description="observed | estimated | predicted")
    g_scale: int = 0


class SpaceWeather(BaseModel):
    updated: datetime
    kp_now: float
    g_scale: int
    g_label: str
    kp_history: list[KpPoint]
    kp_forecast: list[KpPoint]
    solar_wind_speed_kms: float | None = None
    bz_nt: float | None = None
    bt_nt: float | None = None
    aurora_chance: str
    alerts: list[str] = []
    sources: list[str] = []


class Launch(BaseModel):
    id: str
    name: str
    net: datetime | None = None
    status: str
    status_abbrev: str = ""
    provider: str = ""
    rocket: str = ""
    pad: str = ""
    location: str = ""
    mission: str | None = None
    image: str | None = None
    stream_url: str | None = None
    seconds_to_launch: int | None = None


class LaunchBoard(BaseModel):
    updated: datetime
    count: int
    next_launch: Launch | None = None
    results: list[Launch]


class Observer(BaseModel):
    lat: float
    lon: float
    elevation_m: float
    place: str


class SkyObject(BaseModel):
    name: str
    kind: str  # star | planet | sun | moon
    alt: float
    az: float
    magnitude: float | None = None
    extra: str | None = None


class SkyChart(BaseModel):
    at: datetime
    observer: Observer
    sun_alt: float
    is_dark: bool
    moon_phase_deg: float
    moon_phase_name: str
    objects: list[SkyObject]
    note: str = ""
