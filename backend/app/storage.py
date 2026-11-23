import os
from functools import lru_cache

import boto3
from botocore.config import Config

from .config import settings


def r2_enabled() -> bool:
    return bool(settings.r2_endpoint and settings.r2_access_key and settings.r2_bucket)


@lru_cache
def _client():
    return boto3.client(
        "s3",
        endpoint_url=settings.r2_endpoint,
        aws_access_key_id=settings.r2_access_key,
        aws_secret_access_key=settings.r2_secret_key,
        region_name="auto",
        config=Config(signature_version="s3v4"),
    )


def presign_put(key: str, expires: int = 180) -> str:
    return _client().generate_presigned_url(
        "put_object",
        Params={"Bucket": settings.r2_bucket, "Key": key, "ContentType": "image/jpeg"},
        ExpiresIn=expires,
    )


def presign_get(key: str, expires: int = 900) -> str:
    return _client().generate_presigned_url("get_object", Params={"Bucket": settings.r2_bucket, "Key": key}, ExpiresIn=expires)


def local_path(key: str) -> str:
    safe = os.path.normpath(key).lstrip("/\\")
    if safe.startswith(".."):
        raise ValueError("bad key")
    return os.path.join(settings.local_storage_dir, safe)


def delete_keys(keys: list[str]) -> None:
    if r2_enabled():
        for i in range(0, len(keys), 1000):
            chunk = keys[i : i + 1000]
            _client().delete_objects(Bucket=settings.r2_bucket, Delete={"Objects": [{"Key": k} for k in chunk]})
    else:
        for k in keys:
            try:
                os.remove(local_path(k))
            except OSError:
                pass
