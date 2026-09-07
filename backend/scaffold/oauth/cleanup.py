"""Nightly tidying of the connector tables.

Three things here grow on their own and nothing else removes them:

  oauth_clients      Every user who adds the connector triggers their own
                     dynamic registration, so a row appears per connection
                     attempt — and registration is anonymous, so a stranger who
                     can reach /oauth/register can add rows at will. A client
                     that never became a connection is rubbish after a few days.

  oauth_auth_codes   Deleted when redeemed, and redemption is nearly immediate.
                     A code that is approved and then never exchanged — the
                     client crashed, the user closed the tab — is never touched
                     again and would sit there for good.

  mcp_audit          Append-only by design; bounded by retention and a
                     per-account ceiling in audit.py.

  import_proposals   A draft an assistant prepared and the user never opened.
                     One per account, so this is small, but a stale draft is
                     worse than none — it would offer figures the user has
                     since changed.
"""
import logging
from datetime import datetime, timedelta, timezone

from sqlalchemy import text
from sqlalchemy.orm import Session

from . import audit
from .models import OAuthAuthCode, OAuthClient

logger = logging.getLogger(__name__)

# How long an unused client registration is kept. Long enough that someone who
# registers, gets distracted and finishes the next day still works.
UNUSED_CLIENT_DAYS = 7


def prune(db: Session) -> dict[str, int]:
    """Remove what nothing will read again. Returns what went, for the log."""
    now = datetime.now(timezone.utc)

    codes = db.query(OAuthAuthCode).filter(
        OAuthAuthCode.expires_at < now - timedelta(hours=1)
    ).delete(synchronize_session=False)

    # A client with no grant has never completed a connection. Compared against
    # created_at rather than last_used_at because last_used_at is only set when
    # a token is issued, which is the same moment a grant appears.
    stale = db.execute(text(
        "SELECT client_id FROM oauth_clients WHERE created_at < :cutoff "
        "AND client_id NOT IN (SELECT client_id FROM oauth_grants)"
    ), {"cutoff": now - timedelta(days=UNUSED_CLIENT_DAYS)}).scalars().all()

    clients = 0
    if stale:
        clients = db.query(OAuthClient).filter(
            OAuthClient.client_id.in_(stale)
        ).delete(synchronize_session=False)

    from scaffold.models import ImportProposal

    proposals = db.query(ImportProposal).filter(
        ImportProposal.expires_at < now
    ).delete(synchronize_session=False)

    db.commit()

    entries = audit.prune(db)

    result = {"auth_codes": codes, "clients": clients, "audit_entries": entries,
              "import_proposals": proposals}
    if any(result.values()):
        logger.info("Connector cleanup removed %s", result)
    return result
