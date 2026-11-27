"""Re-apply deletion tombstones after a database restore (#819).

Run from the backend directory:  python -m tombstone_reapply

Re-deletes any account a restore resurrected after its owner deleted it
(the markers live outside the database; see services/tombstones.py) and
prints how many. The app also applies them at startup; this is the
explicit step the restore procedure in OPERATIONS.md calls for, and its
exit code is non-zero when the tombstone store exists but cannot be
read, so a restore script stops rather than opening the service with
the check unrun.
"""
import logging
import sys

import database
from services.tombstones import apply_tombstones

logger = logging.getLogger(__name__)


def main():
    db = database.SessionLocal()
    try:
        removed = apply_tombstones(db)
        db.commit()
    except Exception:
        db.rollback()
        logger.exception("Could not apply deletion tombstones")
        return 1
    finally:
        db.close()
    print(f"Deletion tombstones applied: {removed} resurrected account(s) re-deleted.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
