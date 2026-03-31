"""
Cache invalidation webhook for Epic deployments.

Epic's batch jobs POST here after writing to the source-of-truth DB so our
Redis cache is pre-warmed before users hit the app.

Auth: Authorization: Bearer <CACHE_INVALIDATE_SECRET>
"""
import os
from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

router = APIRouter(prefix="/api/internal", tags=["internal"])


def _check_auth(request: Request) -> None:
    secret = os.environ.get("CACHE_INVALIDATE_SECRET", "")
    if not secret:
        raise HTTPException(status_code=503, detail="Cache invalidation not configured")
    auth = request.headers.get("Authorization", "")
    if auth != f"Bearer {secret}":
        raise HTTPException(status_code=401, detail="Unauthorized")


class InvalidateRequest(BaseModel):
    scope: str | None = None       # "all" → fan-out all users
    user_ids: list[int] | None = None  # specific users


@router.post("/cache-invalidate", status_code=202)
def cache_invalidate(body: InvalidateRequest, request: Request):
    _check_auth(request)
    from app.event_cache import schedule_recompute, schedule_fan_out

    if body.scope == "all":
        schedule_fan_out()
        return {"queued": "all"}

    if body.user_ids:
        for uid in body.user_ids:
            schedule_recompute(uid)
        return {"queued": len(body.user_ids)}

    raise HTTPException(status_code=400, detail="Provide scope='all' or user_ids=[...]")
