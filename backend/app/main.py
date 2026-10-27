import asyncio
import json
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from pathlib import Path

from fastapi import FastAPI, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from fastapi.staticfiles import StaticFiles

from app.config import get_settings
from app.models import LaunchBoard, SkyChart, SpaceWeather
from app.providers.http import close_client
from app.providers.launches import get_launches
from app.providers.sky import get_sky_chart
from app.providers.space_weather import get_space_weather

s = get_settings()

# Staattiset tiedostot etsitään suhteessa koodiin, ei nykyiseen hakemistoon,
# jotta sovellus toimii sekä repossa (backend/) että Dockerissa (/app).
_APP_DIR = Path(__file__).resolve().parent
_CANDIDATES = [
    _APP_DIR / "frontend",             # jos frontend kopioidaan paketin sisään
    _APP_DIR.parent / "frontend",      # Docker: /app/frontend
    _APP_DIR.parents[1] / "frontend",  # repo: <juuri>/frontend
]
FRONTEND_DIR = next((p for p in _CANDIDATES if p.is_dir()), None)


@asynccontextmanager
async def lifespan(app: FastAPI):
    yield
    await close_client()


app = FastAPI(
    title="OmaAvaruus API",
    version="0.1.0",
    description="Avaruussää, taivaankartta ja reaaliaikaiset rakettilaukaisut.",
    lifespan=lifespan,
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=s.cors_list,
    allow_methods=["GET"],
    allow_headers=["*"],
)


@app.get("/api/health")
async def health() -> dict:
    return {"status": "ok", "time": datetime.now(timezone.utc).isoformat()}


@app.get("/api/config")
async def config() -> dict:
    return {
        "default_lat": s.default_lat,
        "default_lon": s.default_lon,
        "default_place": s.default_place,
        "launch_limit": s.launch_limit,
    }


@app.get("/api/spaceweather", response_model=SpaceWeather)
async def spaceweather(lat: float = Query(default=s.default_lat, ge=-90, le=90)) -> SpaceWeather:
    return await get_space_weather(lat)


@app.get("/api/launches", response_model=LaunchBoard)
async def launches() -> LaunchBoard:
    return await get_launches()


@app.get("/api/launches/stream")
async def launches_stream() -> StreamingResponse:
    """Server-Sent Events: työntää laukaisulistan päivityksen 60 s välein."""

    async def event_source():
        while True:
            try:
                board = await get_launches()
                yield f"event: launches\ndata: {board.model_dump_json()}\n\n"
            except Exception as exc:
                yield f"event: error\ndata: {json.dumps({'message': str(exc)})}\n\n"
            await asyncio.sleep(60)

    return StreamingResponse(event_source(), media_type="text/event-stream", headers={"Cache-Control": "no-cache"})


@app.get("/api/sky", response_model=SkyChart)
async def sky(
    lat: float = Query(default=s.default_lat, ge=-90, le=90),
    lon: float = Query(default=s.default_lon, ge=-180, le=180),
    at: datetime | None = None,
) -> SkyChart:
    moment = at or datetime.now(timezone.utc)
    if moment.tzinfo is None:
        moment = moment.replace(tzinfo=timezone.utc)
    return await get_sky_chart(lat, lon, moment)


if FRONTEND_DIR is not None:
    app.mount("/", StaticFiles(directory=str(FRONTEND_DIR), html=True), name="frontend")
else:
    @app.get("/")
    async def frontend_missing() -> dict:
        return {
            "detail": "frontend/-hakemistoa ei löytynyt",
            "api": ["/api/health", "/api/spaceweather", "/api/launches", "/api/sky"],
        }
