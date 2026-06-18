from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

PROJECT_ROOT = Path(__file__).resolve().parent.parent


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=PROJECT_ROOT / ".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    db_path: Path = Path("./books.db")
    file_storage_path: Path = Path("./storage")
    admin_api_key: str = "changeme"
    anthropic_api_key: str = ""
    port: int = 8000
    cors_origins: str = "http://localhost:8000"

    @property
    def db_path_abs(self) -> Path:
        p = Path(self.db_path)
        return p if p.is_absolute() else (PROJECT_ROOT / p).resolve()

    @property
    def file_storage_path_abs(self) -> Path:
        p = Path(self.file_storage_path)
        return p if p.is_absolute() else (PROJECT_ROOT / p).resolve()

    @property
    def cors_origins_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]


settings = Settings()
