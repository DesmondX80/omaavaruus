from datetime import datetime, timezone

from fastapi.testclient import TestClient

from app.main import app
from app.providers.space_weather import aurora_chance, kp_to_g_scale
from app.providers.sky import moon_phase_name

client = TestClient(app)


def test_kp_to_g_scale():
    assert kp_to_g_scale(4.99) == 0
    assert kp_to_g_scale(5) == 1
    assert kp_to_g_scale(9) == 5


def test_aurora_chance_oulu():
    assert aurora_chance(5, 65.0) in {"Hyvä", "Erittäin hyvä"}


def test_moon_phase_name():
    assert moon_phase_name(180) == "Täysikuu"


def test_health():
    r = client.get("/api/health")
    assert r.status_code == 200 and r.json()["status"] == "ok"


def test_launches_endpoint(monkeypatch):
    from app.models import Launch, LaunchBoard

    async def fake():
        launch = Launch(id="1", name="Test | LEO", net=datetime.now(timezone.utc), status="Go")
        return LaunchBoard(updated=datetime.now(timezone.utc), count=1, next_launch=launch, results=[launch])

    monkeypatch.setattr("app.main.get_launches", fake)
    r = client.get("/api/launches")
    assert r.status_code == 200
    assert r.json()["results"][0]["name"] == "Test | LEO"
