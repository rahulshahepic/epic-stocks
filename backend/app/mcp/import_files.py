"""Bounded downloads of host-authorized ChatGPT files, with pinned public DNS."""
import ipaddress
import re
import socket
import ssl
import threading
import time
from http.client import HTTPSConnection, HTTPException
from urllib.parse import urlsplit

MAX_FILE_BYTES = 5 * 1024 * 1024
MAX_TOTAL_BYTES = 10 * 1024 * 1024
DOWNLOAD_TIMEOUT = 30


def _destination(url):
    if not isinstance(url, str) or len(url) > 12000:
        raise ValueError("Invalid file download URL")
    try:
        p = urlsplit(url)
        host = p.hostname or ""
        port = p.port
    except ValueError:
        raise ValueError("Invalid file download URL") from None
    # Storage names match the provider's file-host patterns, not proof of
    # ownership: even allowed documents are untrusted input to bounded parsers.
    allowed = (host.endswith(".oaiusercontent.com") or
               re.fullmatch(r"oais(?:dmnt|dsor)pr[a-z0-9]+\.blob\.core\.windows\.net", host) or
               re.fullmatch(r"oaisdmntpr[a-z0-9]+aws\.s3\.[a-z0-9-]+\.amazonaws\.com", host))
    if (p.scheme != "https" or not allowed or port not in (None, 443)
            or p.username or p.password or p.fragment):
        raise ValueError("Select a file uploaded to ChatGPT; this download host is not allowed")
    try:
        addresses = socket.getaddrinfo(host, 443, type=socket.SOCK_STREAM)
    except OSError:
        raise ValueError("The file host could not be reached. Select the file again.") from None
    if not addresses or any(not ipaddress.ip_address(a[4][0]).is_global for a in addresses):
        raise ValueError("The file host must resolve to public addresses")
    return p, addresses[0][4][0]


class _PinnedConnection(HTTPSConnection):
    def __init__(self, host, address, deadline):
        super().__init__(host, timeout=15, context=ssl.create_default_context())
        self.address = address
        self.deadline = deadline

    def connect(self):
        # Connect to the checked address, preserving TLS certificate/SNI checks.
        remaining = self.deadline - time.monotonic()
        if remaining <= 0:
            raise TimeoutError("Download deadline exceeded")
        raw = socket.create_connection((self.address, 443), min(self.timeout, remaining))
        try:
            remaining = self.deadline - time.monotonic()
            if remaining <= 0:
                raise TimeoutError("Download deadline exceeded")
            raw.settimeout(min(self.timeout, remaining))
            self.sock = self._context.wrap_socket(raw, server_hostname=self.host)
        except Exception:
            raw.close()
            raise


def download_file(ref):
    if not isinstance(ref, dict) or not isinstance(ref.get("file_id"), str) or not ref["file_id"]:
        raise ValueError("A ChatGPT file reference is required")
    p, address = _destination(ref.get("download_url"))
    deadline = time.monotonic() + DOWNLOAD_TIMEOUT
    connection = _PinnedConnection(p.hostname, address, deadline)
    timer = None
    response = None
    expired = threading.Event()
    try:
        connection.connect()
        download_socket = connection.sock
        def stop_download():
            expired.set()
            try:
                download_socket.shutdown(socket.SHUT_RDWR)
            except OSError:
                pass
        # read()/header parsing may perform many socket reads. A watchdog also
        # interrupts a slow drip inside a single HTTP parser operation.
        timer = threading.Timer(max(0, deadline - time.monotonic()), stop_download)
        timer.daemon = True
        timer.start()
        connection.request("GET", p.path + ("?" + p.query if p.query else ""))
        response = connection.getresponse()
        if response.status != 200:
            raise ValueError("The file link expired or could not be read. Select the file again.")
        if response.getheader("Content-Encoding", "identity") != "identity":
            raise ValueError("Compressed file transfers are not supported")
        chunks, size = [], 0
        while True:
            chunk = response.read1(min(65536, MAX_FILE_BYTES + 1 - size))
            if expired.is_set() or time.monotonic() >= deadline:
                raise ValueError("The file download took too long. Select it again.")
            if not chunk:
                break
            chunks.append(chunk)
            size += len(chunk)
            if size > MAX_FILE_BYTES:
                raise ValueError("Each file must be at most 5 MB")
        raw = b"".join(chunks)
        if not raw:
            raise ValueError("That file is empty")
        return raw
    except (OSError, HTTPException):
        if expired.is_set():
            raise ValueError("The file download took too long. Select it again.") from None
        raise ValueError("The file could not be downloaded. Select it again.") from None
    finally:
        if timer:
            timer.cancel()
        if response:
            response.close()
        connection.close()
