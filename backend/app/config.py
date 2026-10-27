from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Kaikki konfiguraatio ympäristömuuttujista (.env)."""

    model_config = SettingsConfigDict(env_file=".env", env_prefix="OMAVARUUS_", extra="ignore")

    # Oletushavaintopaikka: Oulu
    default_lat: float = 65.0121
    default_lon: float = 25.4651
    default_elevation_m: float = 20.0
    default_place: str = "Oulu"

    # Ulkoiset rajapinnat
    swpc_base: str = "https://services.swpc.noaa.gov"
    ll2_base: str = "https://ll.thespacedevs.com/2.3.0"
    ll2_token: str | None = None  # valinnainen: nostaa ratelimiittiä
    http_timeout_s: float = 10.0

    # Välimuistin TTL sekunteina
    ttl_space_weather: int = 300
    ttl_launches: int = 300
    ttl_sky: int = 60

    launch_limit: int = 10
    cors_origins: str = "http://localhost:5173,http://localhost:8000"

    @property
    def cors_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()
