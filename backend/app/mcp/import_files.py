"""Bounded downloads of host-authorized ChatGPT files, with pinned public DNS."""
import ipaddress
import socket
import ssl
from http.client import HTTPSConnection, HTTPException
from urllib.parse import urlsplit

MAX_FILE_BYTES = 5 * 1024 * 1024
MAX_TOTAL_BYTES = 10 * 1024 * 1024


def _destination(url):
    if not isinstance(url, str) or len(url) > 12000:
        raise ValueError("Invalid file download URL")
    try:
        p = urlsplit(url)
        host = p.hostname or ""
        port = p.port
    except ValueError:
        raise ValueError("Invalid file download URL") from None
    # Only OpenAI-controlled file endpoints; no deployment override or test bypass.
    allowed = (host.endswith(".oaiusercontent.com") or
               (host.startswith(("oais", "sdmnt")) and
                (host.endswith(".blob.core.windows.net") or
                 (".s3." in host and host.endswith(".amazonaws.com")))))
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
    def __init__(self, host, address):
        super().__init__(host, timeout=15, context=ssl.create_default_context())
        self.address = address

    def connect(self):
        # Connect to the checked address, preserving TLS certificate/SNI checks.
        raw = socket.create_connection((self.address, 443), self.timeout)
        try:
            self.sock = self._context.wrap_socket(raw, server_hostname=self.host)
        except Exception:
            raw.close()
            raise


def download_file(ref):
    if not isinstance(ref, dict) or not isinstance(ref.get("file_id"), str) or not ref["file_id"]:
        raise ValueError("A ChatGPT file reference is required")
    p, address = _destination(ref.get("download_url"))
    connection = _PinnedConnection(p.hostname, address)
    try:
        connection.request("GET", p.path + ("?" + p.query if p.query else ""))
        response = connection.getresponse()
        if response.status != 200:
            raise ValueError("The file link expired or could not be read. Select the file again.")
        if response.getheader("Content-Encoding", "identity") != "identity":
            raise ValueError("Compressed file transfers are not supported")
        raw = response.read(MAX_FILE_BYTES + 1)
        if len(raw) > MAX_FILE_BYTES:
            raise ValueError("Each file must be at most 5 MB")
        if not raw:
            raise ValueError("That file is empty")
        return raw
    except (OSError, HTTPException):
        raise ValueError("The file could not be downloaded. Select it again.") from None
    finally:
        connection.close()
