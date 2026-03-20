from contextlib import asynccontextmanager
import os
from fastapi import FastAPI
from database import engine, Base, DATABASE_URL
from routers import auth_router, grants, loans, prices, events, flows


@asynccontextmanager
async def lifespan(app):
    if os.getenv("TESTING") != "1":
        db_path = DATABASE_URL.replace("sqlite:///", "")
        db_dir = os.path.dirname(db_path)
        if db_dir:
            os.makedirs(db_dir, exist_ok=True)
        Base.metadata.create_all(bind=engine)
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
