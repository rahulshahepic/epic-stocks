"""The Alembic revision graph must stay a single line.

`alembic upgrade head` fails outright with "Multiple head revisions are
present" when two migrations claim the same parent, so a branched chain means
the app cannot start at all. The backend suite runs on SQLite and skips
migrations entirely, so nothing here was checked until the container failed its
healthcheck in CI — and the traceback sat in an unflushed stdout buffer, so the
logs showed a hang rather than the error.

Revision ids in this repo are hand-written and not ordered, so the head cannot
be found by sorting filenames. This test reads the graph.
"""
import sys
import os

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from alembic.config import Config
from alembic.script import ScriptDirectory

_ALEMBIC_INI = os.path.join(os.path.dirname(__file__), "..", "alembic.ini")


@pytest.fixture(scope="module")
def script():
    return ScriptDirectory.from_config(Config(_ALEMBIC_INI))


def test_there_is_exactly_one_head(script):
    heads = script.get_heads()
    assert len(heads) == 1, (
        f"the revision graph has {len(heads)} heads ({heads}) — `alembic upgrade "
        "head` refuses to run and the app will not start. A new migration must "
        "set down_revision to the current head, which is the tip of the graph, "
        "not the last filename alphabetically."
    )


def test_no_two_migrations_claim_the_same_parent(script):
    parents: dict[str, list[str]] = {}
    for rev in script.walk_revisions():
        for down in (rev.down_revision or ()) if isinstance(rev.down_revision, tuple) \
                else ([rev.down_revision] if rev.down_revision else []):
            parents.setdefault(down, []).append(rev.revision)

    branched = {p: kids for p, kids in parents.items() if len(kids) > 1}
    assert not branched, f"these revisions have more than one child: {branched}"


def test_every_revision_is_reachable_from_the_base(script):
    """A revision nobody points at is dead code that will never run."""
    head = script.get_current_head()
    reachable = {rev.revision for rev in script.walk_revisions("base", head)}
    all_revs = {rev.revision for rev in script.walk_revisions()}
    assert all_revs == reachable, (
        f"unreachable from head: {sorted(all_revs - reachable)}"
    )
