"""Deletion tombstones (#819, option 1): a backup restore must not
resurrect an account its owner deleted.

The marker lives outside the database, in the backup settings handoff
directory, because a restore replaces the database wholesale — any
in-database record would be restored away with everything else. These
tests pin the write (on commit only, never for synthetic accounts or
financial resets), the restore simulation, the re-registration guard and
the retention pruning.
"""
import sys
import os
from datetime import datetime, timedelta, timezone

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from scaffold.models import User
from scaffold.user_deletion import delete_user
from services import tombstone_protocol as protocol
from services.tombstones import apply_tombstones, record_deletion
from tests.conftest import register_user


def _handoff(tmp_path, monkeypatch):
    monkeypatch.setenv("BACKUP_SETTINGS_DIR", str(tmp_path))
    return tmp_path / protocol.FILE_NAME


def _entries(path):
    return protocol.read_entries(path)


def _resurrect(db_session, original, created_at):
    """What a pg_restore does: the pre-deletion row is simply back."""
    clone = User(email=original.email, provider_name=original.provider_name,
                 google_id=original.google_id, name=original.name,
                 is_synthetic=False, created_at=created_at)
    db_session.add(clone)
    db_session.commit()
    return clone


def test_delete_writes_a_hashed_tombstone(client, db_session, tmp_path, monkeypatch):
    path = _handoff(tmp_path, monkeypatch)
    register_user(client, "gone@example.com")
    user = db_session.query(User).filter_by(email="gone@example.com").one()
    provider, subject = user.provider_name, user.google_id

    assert client.delete("/api/me").status_code == 204

    entries = _entries(path)
    assert len(entries) == 1
    entry = entries[0]
    assert set(entry) == {"subject_hash", "account_created_at", "deleted_at"}
    assert entry["subject_hash"] == protocol.subject_hash(provider, subject)
    raw = path.read_text()
    assert "gone@example.com" not in raw
    assert subject not in raw


def test_admin_delete_also_writes_a_tombstone(client, make_client, db_session, tmp_path, monkeypatch):
    path = _handoff(tmp_path, monkeypatch)
    monkeypatch.setenv("ADMIN_EMAIL", "admin@example.com")
    register_user(client, "target@example.com")
    target_id = db_session.query(User).filter_by(email="target@example.com").one().id

    with make_client("admin@example.com") as admin:
        assert admin.delete(f"/api/admin/users/{target_id}").status_code == 204

    assert len(_entries(path)) == 1


def test_financial_reset_writes_no_tombstone(client, db_session, tmp_path, monkeypatch):
    path = _handoff(tmp_path, monkeypatch)
    register_user(client, "stays@example.com")

    assert client.post("/api/me/reset").status_code == 204

    assert _entries(path) == []
    assert db_session.query(User).filter_by(email="stays@example.com").count() == 1


def test_rolled_back_deletion_writes_no_tombstone(db_session, tmp_path, monkeypatch):
    path = _handoff(tmp_path, monkeypatch)
    user = User(email="rollback@example.com", provider_name="google",
                google_id="sub-rollback", name="Rollback")
    db_session.add(user)
    db_session.commit()

    delete_user(db_session, user.id)
    db_session.rollback()

    assert db_session.query(User).filter_by(email="rollback@example.com").count() == 1
    assert _entries(path) == []


def test_synthetic_deletion_writes_no_tombstone(db_session, tmp_path, monkeypatch):
    path = _handoff(tmp_path, monkeypatch)
    user = User(email="fake@reviewers.example.invalid", provider_name="directory-reviewer",
                google_id="sub-fake", name="FICTIONAL", is_synthetic=True)
    db_session.add(user)
    db_session.commit()

    delete_user(db_session, user.id)
    db_session.commit()

    assert db_session.query(User).count() == 0
    assert _entries(path) == []


def test_restored_account_is_redeleted_and_cannot_sign_in(client, db_session, tmp_path, monkeypatch):
    _handoff(tmp_path, monkeypatch)
    register_user(client, "restored@example.com")
    original = db_session.query(User).filter_by(email="restored@example.com").one()
    created_at = original.created_at

    assert client.delete("/api/me").status_code == 204

    clone = _resurrect(db_session, original, created_at)
    # The match is by hashed identifier and creation time, never by row
    # id — a restore may or may not preserve it.
    assert clone.email == original.email
    # Before the check runs, the resurrected account is a live account.
    from scaffold.auth import create_token
    token = create_token(clone.id, clone.session_version)

    assert apply_tombstones(db_session) == 1
    db_session.commit()

    assert db_session.query(User).filter_by(email="restored@example.com").count() == 0
    assert client.get("/api/me", headers={"Authorization": "Bearer " + token}).status_code == 401


def test_reregistered_account_is_never_matched(client, db_session, tmp_path, monkeypatch):
    _handoff(tmp_path, monkeypatch)
    register_user(client, "returns@example.com")
    original = db_session.query(User).filter_by(email="returns@example.com").one()

    assert client.delete("/api/me").status_code == 204

    # The same person signs up again afterwards: a new account, created
    # after the deletion. The tombstone must not reach it.
    clone = _resurrect(db_session, original, datetime.now(timezone.utc) + timedelta(minutes=1))
    assert apply_tombstones(db_session) == 0
    db_session.commit()
    assert db_session.get(User, clone.id) is not None


def test_account_that_later_holds_the_deleted_accounts_email_is_untouched(client, db_session, tmp_path, monkeypatch):
    """The review repro: email is mutable. An older live account whose
    address is rewritten at sign-in to a deleted account's address must
    not be re-deleted — matching is by subject hash only."""
    _handoff(tmp_path, monkeypatch)
    register_user(client, "first@example.com")
    register_user(client, "second@example.com")
    first = db_session.query(User).filter_by(email="first@example.com").one()
    second = db_session.query(User).filter_by(email="second@example.com").one()

    delete_user(db_session, second.id)
    db_session.commit()

    # The surviving account's IdP profile now carries the deleted
    # account's address; sign-in rewrites users.email from the profile.
    first.email = "second@example.com"
    db_session.commit()

    assert apply_tombstones(db_session) == 0
    db_session.commit()
    assert db_session.get(User, first.id) is not None


def test_apply_without_handoff_or_entries_is_a_noop(db_session, tmp_path, monkeypatch):
    monkeypatch.delenv("BACKUP_SETTINGS_DIR", raising=False)
    assert apply_tombstones(db_session) == 0
    assert record_deletion("google", "sub-x", datetime.now(timezone.utc)) is False
    _handoff(tmp_path, monkeypatch)
    assert apply_tombstones(db_session) == 0


def test_corrupt_store_fails_loudly_instead_of_being_overwritten(db_session, tmp_path, monkeypatch):
    path = _handoff(tmp_path, monkeypatch)
    path.write_text('{"version": 1, "entries": [{"plaintext": "nope"}]}')
    try:
        record_deletion("google", "sub-y", datetime.now(timezone.utc))
        raise AssertionError("expected ValueError")
    except ValueError:
        pass
    assert "nope" in path.read_text()


def test_entries_survive_while_backups_are_unverified(tmp_path, monkeypatch):
    """Pruning assumes the host prunes its archives on the same rule, so
    it only runs while backups verifiably succeed on schedule. While the
    host status cannot be verified, old entries are kept, not pruned."""
    path = _handoff(tmp_path, monkeypatch)
    from services import backup_admin
    import services.tombstones as tombstones_module
    old = [protocol.entry_for("google", f"sub-old-{index}",
                              datetime(2025, 1, 1, tzinfo=timezone.utc),
                              datetime(2025, 1, 2, tzinfo=timezone.utc))
           for index in range(10)]
    with backup_admin.locked() as folder:
        backup_admin.write_json(folder / protocol.FILE_NAME,
                                {"version": protocol.VERSION, "entries": old})

    monkeypatch.setattr(tombstones_module, "_backups_running", lambda: False)
    assert record_deletion("google", "sub-new", datetime.now(timezone.utc)) is True
    assert len(_entries(path)) == 11

    monkeypatch.setattr(tombstones_module, "_backups_running", lambda: True)
    assert record_deletion("google", "sub-newer", datetime.now(timezone.utc)) is True
    kept = _entries(path)
    kept_subjects = {e["subject_hash"] for e in kept}
    assert len(kept) == 7
    assert protocol.subject_hash("google", "sub-new") in kept_subjects
    assert protocol.subject_hash("google", "sub-newer") in kept_subjects


def test_pruning_keeps_the_window_plus_the_newest_seven():
    now = datetime(2026, 12, 1, tzinfo=timezone.utc)
    entries = []
    for index in range(12):
        deleted = now - timedelta(days=100 - index)
        entries.append(protocol.entry_for("google", f"sub-{index}",
                                          deleted - timedelta(days=30), deleted))
    fresh = protocol.entry_for("google", "sub-fresh",
                               now - timedelta(days=40), now - timedelta(days=5))
    kept = protocol.prune_entries(entries + [fresh], now, retention_days=30)
    kept_subjects = {e["subject_hash"] for e in kept}
    # The fresh entry is inside the window and counts among the newest
    # seven, which are always kept — the same floor the backups keep. Of
    # the twelve stale entries only the six newest survive alongside it.
    assert protocol.subject_hash("google", "sub-fresh") in kept_subjects
    assert len(kept) == 7
    assert protocol.subject_hash("google", "sub-0") not in kept_subjects
    assert protocol.subject_hash("google", "sub-5") not in kept_subjects
    assert protocol.subject_hash("google", "sub-6") in kept_subjects
    assert protocol.subject_hash("google", "sub-11") in kept_subjects
