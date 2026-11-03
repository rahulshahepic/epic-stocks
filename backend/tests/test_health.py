import pytest


@pytest.mark.parametrize("maintenance", [False, True])
def test_anonymous_health_supports_get_and_head(client, monkeypatch, maintenance):
    monkeypatch.setattr("scaffold.maintenance.is_maintenance_active", lambda: maintenance)
    headers = {"User-Agent": "Mozilla/5.0+(compatible; UptimeRobot/2.0; http://www.uptimerobot.com/)"}

    get = client.get("/api/health", headers=headers)
    head = client.head("/api/health", headers=headers)

    assert get.status_code == head.status_code == 200
    assert get.json() == {"status": "ok"}
    assert head.content == b""
    assert head.headers["content-type"] == get.headers["content-type"]
    assert head.headers["content-length"] == get.headers["content-length"]


def test_health_rejects_writes(client):
    assert client.post("/api/health").status_code == 405
