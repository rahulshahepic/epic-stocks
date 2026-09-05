"""A cap on the request body, applied before anything reads it.

Without one, a multipart POST is fully spooled by the parser before the
endpoint's dependencies run — so before authentication, before the rate limit,
and before the per-file 5 MB check inside the handler. An anonymous caller can
make the server write megabytes to disk for every request and collect a 401 for
it, and file parts an endpoint does not even declare are spooled just the same,
because the parser reads the whole body before FastAPI decides which fields it
wanted.

The cap therefore has to live above the application, in the ASGI layer:

  * A declared Content-Length over the limit is refused outright — nothing is
    read at all, which is the case that matters for a flood.
  * A chunked request declares no length, so its body is read here, counted,
    and abandoned the moment it goes over. At most `limit` bytes are ever
    held, and the endpoint is never entered.
  * A request that fits is passed through with its receive channel untouched,
    so the multipart parser still streams and still spools to disk rather than
    being buffered whole in memory.

Caddy enforces the same ceiling in front of the app (`request_body max_size`),
which is where a flood should die. This is the half that survives someone
reaching the container directly, and the half that can be different per path.
"""
import logging

logger = logging.getLogger(__name__)

# DELETE is here because this app has one that carries a body
# (DELETE /api/push/subscribe); the ceiling costs it nothing.
_BODY_METHODS = frozenset({"POST", "PUT", "PATCH", "DELETE"})


class BodyLimitMiddleware:
    """Reject a request body larger than the limit for its path.

    `limits` is (path prefix, max bytes), longest prefix wins; `default` covers
    everything else.
    """

    def __init__(self, app, limits: tuple[tuple[str, int], ...] = (), default: int = 1024 * 1024):
        self.app = app
        self.limits = tuple(sorted(limits, key=lambda item: len(item[0]), reverse=True))
        self.default = default

    def limit_for(self, path: str) -> int:
        for prefix, limit in self.limits:
            if path == prefix or path.startswith(prefix):
                return limit
        return self.default

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http" or scope.get("method", "GET") not in _BODY_METHODS:
            await self.app(scope, receive, send)
            return

        limit = self.limit_for(scope.get("path", ""))
        headers = dict(scope.get("headers", []))
        raw_length = headers.get(b"content-length")

        if raw_length is not None:
            try:
                declared = int(raw_length)
            except ValueError:
                await self._too_large(scope, send, limit)
                return
            if declared > limit:
                await self._too_large(scope, send, limit)
                return
            # The server enforces the length it was given, so nothing more than
            # `declared` bytes can arrive. Leave the stream alone.
            await self.app(scope, receive, send)
            return

        # No declared length: chunked. Read it here so the count is ours, then
        # replay it to the app if it stayed under the limit.
        buffered, over = await self._buffer(receive, limit)
        if over:
            await self._too_large(scope, send, limit)
            return
        await self.app(scope, _replay(buffered), send)

    @staticmethod
    async def _buffer(receive, limit: int) -> tuple[list[dict], bool]:
        messages: list[dict] = []
        total = 0
        while True:
            message = await receive()
            if message["type"] != "http.request":
                messages.append(message)  # http.disconnect — hand it on as-is
                return messages, False
            total += len(message.get("body", b""))
            if total > limit:
                return messages, True
            messages.append(message)
            if not message.get("more_body", False):
                return messages, False

    async def _too_large(self, scope, send, limit: int) -> None:
        logger.warning(
            "Refused an oversized request body on %s %s (limit %d bytes)",
            scope.get("method"), scope.get("path"), limit,
        )
        body = (
            b'{"detail":"Request body too large (limit '
            + str(limit // (1024 * 1024)).encode()
            + b' MB)"}'
        )
        await send({
            "type": "http.response.start",
            "status": 413,
            "headers": [
                (b"content-type", b"application/json"),
                (b"content-length", str(len(body)).encode()),
                (b"connection", b"close"),
            ],
        })
        await send({"type": "http.response.body", "body": body})


def _replay(messages: list[dict]):
    """Hand the buffered messages back to the app, in order."""
    async def receive():
        if messages:
            return messages.pop(0)
        return {"type": "http.disconnect"}
    return receive
