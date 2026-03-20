import os
from contextlib import asynccontextmanager
from fastapi import FastAPI
import database
from routers import auth_router, grants, loans, prices, events, flows


@asynccontextmanager
async def lifespan(app):
    database.Base.metadata.create_all(bind=database.engine)
    yield


app = FastAPI(title="Equity Vesting Tracker", lifespan=lifespan)

app.include_router(auth_router.router)
app.include_router(grants.router)
app.include_router(loans.router)
app.include_router(prices.router)
app.include_router(events.router)
app.include_router(flows.router)


@app.get("/api/health")
def health():
    return {"status": "ok"}


@app.get("/api/config")
def client_config():
    from auth import GOOGLE_CLIENT_ID
    privacy_url = os.environ.get("PRIVACY_URL", "")
    return {"google_client_id": GOOGLE_CLIENT_ID, "privacy_url": privacy_url}
