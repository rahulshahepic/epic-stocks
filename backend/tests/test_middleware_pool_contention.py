"""A middleware cache miss must not prevent active requests releasing DB slots."""
import asyncio

import pytest
from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker

import database
from main import EpicModeMiddleware, MaintenanceMiddleware
from scaffold import epic_mode, maintenance


@pytest.mark.asyncio
@pytest.mark.parametrize('middleware,module,key,status', [
    (MaintenanceMiddleware, maintenance, 'maintenance_active', 503),
    (EpicModeMiddleware, epic_mode, 'epic_mode', 403),
])
async def test_cache_miss_allows_request_cleanup_to_release_pool(
    tmp_path, monkeypatch, middleware, module, key, status,
):
    engine = create_engine(
        f"sqlite:///{tmp_path / 'pool.db'}", pool_size=1, max_overflow=0,
        pool_timeout=1, connect_args={'check_same_thread': False},
    )
    with engine.begin() as conn:
        conn.execute(text('CREATE TABLE system_settings (key TEXT, value TEXT)'))
        conn.execute(text('INSERT INTO system_settings VALUES (:key, :value)'),
                     {'key': key, 'value': 'true'})
    monkeypatch.setattr(database, 'SessionLocal', sessionmaker(bind=engine))
    monkeypatch.setattr(module, '_cache', None)
    monkeypatch.delenv('EPIC_MODE', raising=False)
    occupied = engine.connect()
    messages = []

    async def release_request_connection():
        await asyncio.sleep(0.01)
        occupied.close()

    async def downstream(scope, receive, send):
        await send({'type': 'http.response.start', 'status': 200, 'headers': []})

    async def receive():
        return {'type': 'http.request', 'body': b''}

    async def send(message):
        messages.append(message)

    cleanup = asyncio.create_task(release_request_connection())
    try:
        await middleware(downstream)(
            {'type': 'http', 'method': 'POST', 'path': '/api/grants', 'headers': []},
            receive, send,
        )
        assert next(m['status'] for m in messages if m['type'] == 'http.response.start') == status
    finally:
        await cleanup
        occupied.close()
        engine.dispose()
