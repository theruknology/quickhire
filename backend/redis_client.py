"""
Redis helpers — mirrors the reference project's infra/db.py.
"""
import redis
from config import REDIS_HOST, REDIS_PORT


def get_redis_client():
    """Return a Redis client (shared pattern from reference project)."""
    return redis.Redis(
        host=REDIS_HOST,
        port=REDIS_PORT,
        decode_responses=True,
    )
