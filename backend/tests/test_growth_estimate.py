from datetime import date, timedelta
from tests.conftest import register_user

# Use dates guaranteed to be in the future relative to any reasonable test run
NEXT_YEAR = date.today().year + 1
START = date(NEXT_YEAR, 1, 1)
MID = date(NEXT_YEAR + 1, 1, 1)
END = date(NEXT_YEAR + 2, 1, 1)


def test_growth_estimate_annual(client):
    register_user(client)
    resp = client.post("/api/flows/growth-estimate", json={
        "base_price": 10.0,
        "start_date": START.isoformat(),
        "end_date": END.isoformat(),
        "annual_rate_pct": 10.0,
        "frequency": "annual",
    })
    assert resp.status_code == 201
    data = resp.json()
    assert len(data) == 3  # START, START+1yr, START+2yr
    assert data[0]["effective_date"] == START.isoformat()
    assert data[0]["price"] == 10.0
    assert abs(data[1]["price"] - 11.0) < 0.05
    assert abs(data[2]["price"] - 12.1) < 0.05


def test_growth_estimate_quarterly(client):
    register_user(client)
    resp = client.post("/api/flows/growth-estimate", json={
        "base_price": 100.0,
        "start_date": START.isoformat(),
        "end_date": date(NEXT_YEAR, 12, 31).isoformat(),
        "annual_rate_pct": 0.0,
        "frequency": "quarterly",
    })
    assert resp.status_code == 201
    data = resp.json()
    assert len(data) == 4  # Jan, Apr, Jul, Oct
    for entry in data:
        assert entry["price"] == 100.0  # 0% growth → flat


def test_growth_estimate_monthly(client):
    register_user(client)
    resp = client.post("/api/flows/growth-estimate", json={
        "base_price": 50.0,
        "start_date": START.isoformat(),
        "end_date": date(NEXT_YEAR, 3, 31).isoformat(),
        "annual_rate_pct": 12.0,
        "frequency": "monthly",
    })
    assert resp.status_code == 201
    data = resp.json()
    assert len(data) == 3  # Jan, Feb, Mar
    assert data[0]["effective_date"] == START.isoformat()
    assert data[0]["price"] == 50.0
    assert data[1]["price"] > 50.0


def test_growth_estimate_rejects_past_start(client):
    register_user(client)
    yesterday = (date.today() - timedelta(days=1)).isoformat()
    resp = client.post("/api/flows/growth-estimate", json={
        "base_price": 10.0,
        "start_date": yesterday,
        "end_date": END.isoformat(),
        "annual_rate_pct": 10.0,
        "frequency": "annual",
    })
    assert resp.status_code == 422
    assert "future" in resp.json()["detail"]


def test_growth_estimate_rejects_today_start(client):
    register_user(client)
    resp = client.post("/api/flows/growth-estimate", json={
        "base_price": 10.0,
        "start_date": date.today().isoformat(),
        "end_date": END.isoformat(),
        "annual_rate_pct": 10.0,
        "frequency": "annual",
    })
    assert resp.status_code == 422


def test_growth_estimate_replaces_existing_future_prices(client):
    register_user(client)
    # First run at 10%/year
    client.post("/api/flows/growth-estimate", json={
        "base_price": 10.0,
        "start_date": START.isoformat(),
        "end_date": END.isoformat(),
        "annual_rate_pct": 10.0,
        "frequency": "annual",
    })
    prices_before = client.get("/api/prices").json()
    assert len(prices_before) == 3

    # Second run at 20%/year over the same range — should replace, not append
    resp = client.post("/api/flows/growth-estimate", json={
        "base_price": 10.0,
        "start_date": START.isoformat(),
        "end_date": END.isoformat(),
        "annual_rate_pct": 20.0,
        "frequency": "annual",
    })
    assert resp.status_code == 201
    prices_after = client.get("/api/prices").json()
    assert len(prices_after) == 3  # still 3, not 6
    assert abs(prices_after[1]["price"] - 12.0) < 0.05  # 20% growth, not 11.0


def test_growth_estimate_does_not_touch_prices_outside_range(client):
    register_user(client)
    # Add a historical price (via direct prices endpoint, not growth estimator)
    historical_date = (date.today() - timedelta(days=365)).isoformat()
    client.post("/api/prices", json={"effective_date": historical_date, "price": 5.0})

    # Run estimator over a future range
    client.post("/api/flows/growth-estimate", json={
        "base_price": 10.0,
        "start_date": START.isoformat(),
        "end_date": MID.isoformat(),
        "annual_rate_pct": 10.0,
        "frequency": "annual",
    })
    prices = client.get("/api/prices").json()
    # Historical price must still be present
    assert any(p["effective_date"] == historical_date for p in prices)
    assert len(prices) == 3  # 1 historical + 2 generated


def test_growth_estimate_end_before_start(client):
    register_user(client)
    resp = client.post("/api/flows/growth-estimate", json={
        "base_price": 10.0,
        "start_date": END.isoformat(),
        "end_date": START.isoformat(),
        "annual_rate_pct": 10.0,
        "frequency": "annual",
    })
    assert resp.status_code == 422


def test_growth_estimate_invalid_frequency(client):
    register_user(client)
    resp = client.post("/api/flows/growth-estimate", json={
        "base_price": 10.0,
        "start_date": START.isoformat(),
        "end_date": END.isoformat(),
        "annual_rate_pct": 10.0,
        "frequency": "weekly",
    })
    assert resp.status_code == 422


def test_growth_estimate_negative_base_price(client):
    register_user(client)
    resp = client.post("/api/flows/growth-estimate", json={
        "base_price": -5.0,
        "start_date": START.isoformat(),
        "end_date": END.isoformat(),
        "annual_rate_pct": 10.0,
        "frequency": "annual",
    })
    assert resp.status_code == 422


def test_growth_estimate_requires_auth(client):
    resp = client.post("/api/flows/growth-estimate", json={
        "base_price": 10.0,
        "start_date": START.isoformat(),
        "end_date": END.isoformat(),
        "annual_rate_pct": 10.0,
        "frequency": "annual",
    })
    assert resp.status_code == 401
