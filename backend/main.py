import os
from contextlib import asynccontextmanager
from fastapi import FastAPI
import database
from routers import auth_router, grants, loans, prices, events, flows, import_export
from crypto import encryption_enabled, decrypt_user_key, set_current_key


@asynccontextmanager
async def lifespan(app):
    database.Base.metadata.create_all(bind=database.engine)
    yield


class EncryptionMiddleware:
    """Pure ASGI middleware that sets per-user encryption key in contextvar.

    Runs in the event loop context so the contextvar propagates to
    sync endpoint functions running in threadpool workers.
    """

    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] == "http" and encryption_enabled():
            headers = dict(scope.get("headers", []))
            auth = headers.get(b"authorization", b"").decode()
            if auth.startswith("Bearer "):
                self._try_set_key(auth[7:])
        try:
            await self.app(scope, receive, send)
        finally:
            set_current_key(None)

    def _try_set_key(self, token: str):
        from auth import _decode_token
        from models import User
        try:
            payload = _decode_token(token)
            user_id = int(payload["sub"])
            db = database.SessionLocal()
            try:
                user = db.get(User, user_id)
                if user and user.encrypted_key:
                    set_current_key(decrypt_user_key(user.encrypted_key))
            finally:
                db.close()
        except Exception:
            pass


_fastapi_app = FastAPI(title="Equity Vesting Tracker", lifespan=lifespan)

_fastapi_app.include_router(auth_router.router)
_fastapi_app.include_router(grants.router)
_fastapi_app.include_router(loans.router)
_fastapi_app.include_router(prices.router)
_fastapi_app.include_router(events.router)
_fastapi_app.include_router(flows.router)
_fastapi_app.include_router(import_export.router)


@_fastapi_app.get("/api/health")
def health():
    return {"status": "ok"}


@_fastapi_app.get("/api/config")
def client_config():
    from auth import GOOGLE_CLIENT_ID
    privacy_url = os.environ.get("PRIVACY_URL", "")
    return {"google_client_id": GOOGLE_CLIENT_ID, "privacy_url": privacy_url}


# Wrap FastAPI app with encryption middleware
app = EncryptionMiddleware(_fastapi_app)
