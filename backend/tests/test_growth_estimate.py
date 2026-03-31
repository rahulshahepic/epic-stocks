from tests.conftest import register_user


def test_growth_estimate_annual(client):
    register_user(client)
    resp = client.post("/api/flows/growth-estimate", json={
        "base_price": 10.0,
        "start_date": "2025-01-01",
        "end_date": "2027-01-01",
        "annual_rate_pct": 10.0,
        "frequency": "annual",
    })
    assert resp.status_code == 201
    data = resp.json()
    assert len(data) == 3  # 2025, 2026, 2027
    assert data[0]["effective_date"] == "2025-01-01"
    assert data[0]["price"] == 10.0
    assert data[1]["effective_date"] == "2026-01-01"
    assert abs(data[1]["price"] - 11.0) < 0.05
    assert data[2]["effective_date"] == "2027-01-01"
    assert abs(data[2]["price"] - 12.1) < 0.05


def test_growth_estimate_quarterly(client):
    register_user(client)
    resp = client.post("/api/flows/growth-estimate", json={
        "base_price": 100.0,
        "start_date": "2025-01-01",
        "end_date": "2025-12-31",
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
        "start_date": "2025-01-01",
        "end_date": "2025-03-31",
        "annual_rate_pct": 12.0,
        "frequency": "monthly",
    })
    assert resp.status_code == 201
    data = resp.json()
    assert len(data) == 3  # Jan, Feb, Mar
    assert data[0]["effective_date"] == "2025-01-01"
    assert data[0]["price"] == 50.0
    assert data[1]["effective_date"] == "2025-02-01"
    assert data[1]["price"] > 50.0


def test_growth_estimate_end_before_start(client):
    register_user(client)
    resp = client.post("/api/flows/growth-estimate", json={
        "base_price": 10.0,
        "start_date": "2025-06-01",
        "end_date": "2025-01-01",
        "annual_rate_pct": 10.0,
        "frequency": "annual",
    })
    assert resp.status_code == 422


def test_growth_estimate_invalid_frequency(client):
    register_user(client)
    resp = client.post("/api/flows/growth-estimate", json={
        "base_price": 10.0,
        "start_date": "2025-01-01",
        "end_date": "2026-01-01",
        "annual_rate_pct": 10.0,
        "frequency": "weekly",
    })
    assert resp.status_code == 422


def test_growth_estimate_negative_base_price(client):
    register_user(client)
    resp = client.post("/api/flows/growth-estimate", json={
        "base_price": -5.0,
        "start_date": "2025-01-01",
        "end_date": "2026-01-01",
        "annual_rate_pct": 10.0,
        "frequency": "annual",
    })
    assert resp.status_code == 422


def test_growth_estimate_requires_auth(client):
    resp = client.post("/api/flows/growth-estimate", json={
        "base_price": 10.0,
        "start_date": "2025-01-01",
        "end_date": "2026-01-01",
        "annual_rate_pct": 10.0,
        "frequency": "annual",
    })
    assert resp.status_code == 401


def test_growth_estimate_persists_prices(client):
    register_user(client)
    client.post("/api/flows/growth-estimate", json={
        "base_price": 20.0,
        "start_date": "2025-01-01",
        "end_date": "2026-01-01",
        "annual_rate_pct": 5.0,
        "frequency": "annual",
    })
    prices = client.get("/api/prices").json()
    assert len(prices) == 2
    assert prices[0]["effective_date"] == "2025-01-01"
    assert prices[0]["price"] == 20.0
