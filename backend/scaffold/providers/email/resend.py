"""Resend (https://resend.com) email provider."""
import logging
import os

import httpx

logger = logging.getLogger(__name__)

RESEND_API_URL = "https://api.resend.com/emails"


class ResendEmailProvider:
    def __init__(self):
        self._api_key = os.getenv("RESEND_API_KEY", "")
        self._from_addr = os.getenv("RESEND_FROM", "")

    def is_configured(self) -> bool:
        return bool(self._api_key and self._from_addr)

    def send(self, to: str, subject: str, text: str, html: str | None = None, *, headers: dict[str, str] | None = None) -> bool:
        api_key = os.getenv("RESEND_API_KEY", "")
        from_email = os.getenv("RESEND_FROM", "")
        missing = [k for k, v in [("RESEND_API_KEY", api_key), ("RESEND_FROM", from_email)] if not v]
        if missing:
            logger.warning("%s not set, skipping email", " and ".join(missing))
            return False

        payload: dict = {"from": from_email, "to": [to], "subject": subject, "text": text}
        if html:
            payload["html"] = html
        if headers:
            payload["headers"] = headers

        try:
            resp = httpx.post(
                RESEND_API_URL,
                json=payload,
                headers={"Authorization": f"Bearer {api_key}"},
                timeout=10,
            )
            resp.raise_for_status()
            return True
        except httpx.HTTPStatusError as e:
            detail = e.response.text
            logger.error("Resend HTTP error %s: %s", e.response.status_code, detail)
            raise httpx.HTTPStatusError(
                f"{e} — Resend response: {detail}",
                request=e.request,
                response=e.response,
            ) from e
        except Exception:
            logger.exception("Failed to send email to %s via Resend", to)
            raise
