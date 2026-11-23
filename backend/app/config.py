from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    env: str = "development"
    # Use the Supabase *transaction pooler* URL (port 6543) in production.
    database_url: str = "postgresql+asyncpg://postgres:postgres@localhost:5432/exam"
    db_pool_size: int = 10
    db_max_overflow: int = 10
    auto_create_tables: bool = True

    redis_url: str = "memory://"                       # rate-limit storage
    celery_broker_url: str = "redis://localhost:6379/1"
    jwt_secret: str = "change-me"
    cors_origins: str = "http://localhost:3000"
    app_url: str = "http://localhost:3000"
    org_name: str = "Recruitment Office"

    # Exam rules (defaults follow the brief)
    question_seconds: int = 15
    section_seconds: int = 300
    intro_seconds: int = 4          # short countdown AFTER the candidate presses Proceed
    break_seconds: int = 180        # how long a section may wait for Proceed before it starts by itself
    questions_per_section: int = 25
    max_violations: int = 3
    pass_percent: int = 70      # >= this = PASS (green)
    fail_percent: int = 50      # <= this = FAIL (red); in between = CONSIDER (blue)
    late_sync_grace_ms: int = 1500

    # Rate limits. Candidates in one venue may share a public IP, so keep generous.
    login_rate: str = "60/minute"
    admin_login_rate: str = "10/minute"
    admin_session_minutes: int = 480

    # Cloudflare R2 (S3 compatible). If empty, snapshots are stored on local disk.
    r2_endpoint: str = ""
    r2_access_key: str = ""
    r2_secret_key: str = ""
    r2_bucket: str = ""
    local_storage_dir: str = "./storage"
    snapshot_retention_days: int = 30

    # Email (Resend)
    resend_api_key: str = ""
    mail_from: str = "Recruitment Office <exams@example.com>"
    invite_rate_limit: str = "2/s"                     # Resend default is 2 req/s


settings = Settings()
