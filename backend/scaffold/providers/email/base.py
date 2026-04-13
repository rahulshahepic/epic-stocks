from typing import Protocol, runtime_checkable


@runtime_checkable
class EmailProvider(Protocol):
    def is_configured(self) -> bool: ...
    def send(self, to: str, subject: str, text: str, html: str | None = None, *, headers: dict[str, str] | None = None) -> bool: ...
