from fastapi import FastAPI
from database import engine, Base
from routers import auth_router, grants, loans, prices, events, flows

Base.metadata.create_all(bind=engine)

app = FastAPI(title="Equity Vesting Tracker")

app.include_router(auth_router.router)
app.include_router(grants.router)
app.include_router(loans.router)
app.include_router(prices.router)
app.include_router(events.router)
app.include_router(flows.router)


@app.get("/api/health")
def health():
    return {"status": "ok"}
