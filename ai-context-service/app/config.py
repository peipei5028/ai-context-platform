from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    DATABASE_URL: str = "mysql+aiomysql://root:password@localhost:3306/ai_context"
    GITNEXUS_HOME: str = "/mnt/nfs/repos/.gitnexus"
    GITNEXUS_SERVE_URL: str = "http://localhost:4747"
    GITNEXUS_CLI_PATH: str = "gitnexus"
    REPOS_ROOT_DIR: str = "/mnt/nfs/repos"
    MAX_CONCURRENT_INDEX_JOBS: int = 3
    GITNEXUS_WIKI_MODEL: str = "gpt-4o-mini"
    OPENAI_API_KEY: str = ""
    HOST: str = "0.0.0.0"
    PORT: int = 8000
    LOG_LEVEL: str = "INFO"

    # Auth
    JWT_SECRET_KEY: str = "change-me-in-production"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 30
    REFRESH_TOKEN_EXPIRE_DAYS: int = 7

    # Redis
    REDIS_URL: str = "redis://localhost:6379/0"

    # S3 / MinIO
    S3_ENDPOINT: str = "http://localhost:9000"
    S3_ACCESS_KEY: str = "minioadmin"
    S3_SECRET_KEY: str = "minioadmin"
    S3_BUCKET: str = "ai-context"
    S3_REGION: str = ""

    # Encryption (AES-256-GCM for GitLab credentials)
    GITLAB_ENCRYPTION_KEY: str = "change-me-32-bytes-aes-key!!!!"

    # Code read limits
    CODE_READ_MAX_BYTES: int = 65536  # 64KB per file
    CODE_READ_MAX_ITEMS: int = 20     # max items per batch request

    model_config = {"env_file": ".env", "env_file_encoding": "utf-8"}


settings = Settings()
