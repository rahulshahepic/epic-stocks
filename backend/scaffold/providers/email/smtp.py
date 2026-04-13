"""SMTP email provider — works with any SMTP server (Gmail, SES, Mailgun, etc.)."""
import logging
import os
import smtplib
import ssl
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText

logger = logging.getLogger(__name__)


class SmtpEmailProvider:
    def __init__(self):
        self._host = os.getenv("SMTP_HOST", "")
        self._port = int(os.getenv("SMTP_PORT", "587"))
        self._user = os.getenv("SMTP_USER", "")
        self._password = os.getenv("SMTP_PASSWORD", "")
        self._from_addr = os.getenv("SMTP_FROM", "")

    def is_configured(self) -> bool:
        return bool(self._host and self._from_addr)

    def send(self, to: str, subject: str, text: str, html: str | None = None, *, headers: dict[str, str] | None = None) -> bool:
        host = os.getenv("SMTP_HOST", "")
        port = int(os.getenv("SMTP_PORT", "587"))
        user = os.getenv("SMTP_USER", "")
        password = os.getenv("SMTP_PASSWORD", "")
        from_addr = os.getenv("SMTP_FROM", "")

        if not host or not from_addr:
            logger.warning("SMTP_HOST or SMTP_FROM not set, skipping email")
            return False

        msg = MIMEMultipart("alternative")
        msg["Subject"] = subject
        msg["From"] = from_addr
        msg["To"] = to
        if headers:
            for key, value in headers.items():
                msg[key] = value
        msg.attach(MIMEText(text, "plain"))
        if html:
            msg.attach(MIMEText(html, "html"))

        try:
            context = ssl.create_default_context()
            with smtplib.SMTP(host, port) as server:
                server.ehlo()
                server.starttls(context=context)
                if user and password:
                    server.login(user, password)
                server.sendmail(from_addr, [to], msg.as_string())
            return True
        except Exception:
            logger.exception("Failed to send email to %s via SMTP", to)
            raise
