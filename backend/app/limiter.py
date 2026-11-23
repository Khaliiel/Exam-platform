from fastapi import Request
from slowapi import Limiter

from .config import settings


def client_ip(request: Request) -> str:
    # Caddy/nginx must overwrite X-Real-IP (see deploy/Caddyfile)
    return request.headers.get("x-real-ip") or (request.client.host if request.client else "unknown")


limiter = Limiter(key_func=client_ip, storage_uri=settings.redis_url)
