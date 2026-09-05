"""The HTTP session pywebpush is made to send through.

validate_push_endpoint checks the URL that gets stored. What it cannot check
is where the push service sends the request *next*: requests follows redirects
by default, so a 302 pointing at http://169.254.169.254/ turns an endpoint that
passed every check into a request to the metadata service, issued from inside
the network. The response body never comes back, but POST /api/push/test
returns a delivered/refused count, which is enough to probe with.

So the transport itself, not only the stored URL, is constrained:

  * Redirects are never followed. A push service has no reason to redirect a
    POST to the send endpoint it handed the browser; a 3xx is a signal
    something is wrong, and it is reported as a failure rather than chased.
  * Every request is re-validated on the way out, raising
    PushEndpointRejected, so a URL that reached the session without going
    through validate_push_endpoint still cannot leave.

The session is built per send rather than kept alive: connection reuse across
sends is worth little for a handful of notifications a day, and a pooled
connection to a host whose DNS has since moved is exactly what the send-time
re-check exists to prevent.
"""
import requests

from scaffold.push_endpoints import validate_push_endpoint


class GuardedPushSession(requests.Session):
    """A requests Session that will not follow a redirect or leave the allowlist."""

    def request(self, method, url, *args, **kwargs):  # type: ignore[override]
        validate_push_endpoint(str(url))
        kwargs["allow_redirects"] = False
        return super().request(method, url, *args, **kwargs)


def push_session() -> GuardedPushSession:
    return GuardedPushSession()
