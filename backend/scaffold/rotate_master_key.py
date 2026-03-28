#!/usr/bin/env python3
"""
Rotate the ENCRYPTION_MASTER_KEY or enable encryption on a plaintext database.

Modes
-----
rotate-master
    Re-wrap each user's per-user key with a new master key.
    The per-user data fields are NOT touched — they stay encrypted
    under the same per-user key; only the key-wrapping changes.

encrypt
    Migrate a plaintext (no ENCRYPTION_MASTER_KEY) database to encrypted.
    Generates a fresh per-user key for each user, wraps it with the new
    master key, then encrypts every sensitive column.

Usage
-----
  # Key rotation:
  python rotate_master_key.py rotate-master \\
      --old-key <OLD> --new-key <NEW> [--dry-run]

  # Enable encryption on a plaintext DB:
  python rotate_master_key.py encrypt --new-key <NEW> [--dry-run]

Environment variables (alternative to flags)
-------------------------------------------
  DATABASE_URL      required — SQLAlchemy connection string
  OLD_MASTER_KEY    old master key  (rotate-master only)
  NEW_MASTER_KEY    new master key
"""

import argparse
import base64
import hashlib
import os
import sys

from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from sqlalchemy import create_engine, text

_ENC_PREFIX = "$ENC$"

# All tables and their encrypted columns (every column handled by an
# EncryptedFloat / EncryptedInt / EncryptedString TypeDecorator).
ENCRYPTED_COLUMNS: dict[str, list[str]] = {
    "grants":        ["shares", "price", "dp_shares"],
    "loans":         ["amount", "interest_rate", "loan_number"],
    "prices":        ["price"],
    "sales":         [
        "price_per_share",
        "federal_income_rate", "federal_lt_cg_rate", "federal_st_cg_rate",
        "niit_rate",
        "state_income_rate", "state_lt_cg_rate", "state_st_cg_rate",
    ],
    "loan_payments": ["amount"],
    "tax_settings":  [
        "federal_income_rate", "federal_lt_cg_rate", "federal_st_cg_rate",
        "niit_rate",
        "state_income_rate", "state_lt_cg_rate", "state_st_cg_rate",
    ],
}


# ---------------------------------------------------------------------------
# Crypto helpers (no dependency on the app's crypto.py so the script can run
# standalone without the full FastAPI environment)
# ---------------------------------------------------------------------------

def _master_aesgcm(master_key: str) -> AESGCM:
    key = hashlib.sha256(master_key.encode()).digest()
    return AESGCM(key)


def encrypt_user_key(raw_key: bytes, master_key: str) -> str:
    nonce = os.urandom(12)
    ct = _master_aesgcm(master_key).encrypt(nonce, raw_key, None)
    return base64.b64encode(nonce + ct).decode()


def decrypt_user_key(encrypted: str, master_key: str) -> bytes:
    data = base64.b64decode(encrypted)
    return _master_aesgcm(master_key).decrypt(data[:12], data[12:], None)


def encrypt_value(plaintext: str, key: bytes) -> str:
    nonce = os.urandom(12)
    ct = AESGCM(key).encrypt(nonce, plaintext.encode(), None)
    return _ENC_PREFIX + base64.b64encode(nonce + ct).decode()


def decrypt_value(ciphertext: str, key: bytes) -> str:
    data = base64.b64decode(ciphertext[len(_ENC_PREFIX):])
    return AESGCM(key).decrypt(data[:12], data[12:], None).decode()


# ---------------------------------------------------------------------------
# Modes
# ---------------------------------------------------------------------------

def rotate_master(engine, old_master: str, new_master: str, dry_run: bool) -> None:
    """Re-wrap each user's encrypted_key with new_master. Data rows unchanged."""
    with engine.begin() as conn:
        rows = conn.execute(
            text("SELECT id, email, encrypted_key FROM users WHERE encrypted_key IS NOT NULL")
        ).fetchall()

        print(f"Found {len(rows)} user(s) with encrypted keys.")

        for user_id, email, enc_key in rows:
            try:
                raw_key = decrypt_user_key(enc_key, old_master)
            except Exception as exc:
                print(
                    f"  ERROR: cannot decrypt key for {email} (id={user_id}): {exc}",
                    file=sys.stderr,
                )
                raise SystemExit(1)

            new_enc_key = encrypt_user_key(raw_key, new_master)
            print(f"  [{user_id}] {email}: key re-wrapped")

            if not dry_run:
                conn.execute(
                    text("UPDATE users SET encrypted_key = :k WHERE id = :id"),
                    {"k": new_enc_key, "id": user_id},
                )

        if dry_run:
            print("Dry run — no changes written.")
        else:
            print(f"Done. {len(rows)} user key(s) re-wrapped and committed.")


def encrypt_plaintext(engine, new_master: str, dry_run: bool) -> None:
    """Encrypt a plaintext database: assign per-user keys and encrypt all columns."""
    with engine.begin() as conn:
        users = conn.execute(
            text("SELECT id, email, encrypted_key FROM users")
        ).fetchall()

        print(f"Found {len(users)} user(s).")

        for user_id, email, existing_enc_key in users:
            # Resolve (or create) the per-user raw key
            if existing_enc_key:
                try:
                    raw_key = decrypt_user_key(existing_enc_key, new_master)
                    print(f"  [{user_id}] {email}: existing key found, re-checking data")
                except Exception as exc:
                    print(
                        f"  ERROR: {email} has an encrypted_key but it cannot be decrypted "
                        f"with the supplied --new-key: {exc}",
                        file=sys.stderr,
                    )
                    raise SystemExit(1)
            else:
                raw_key = AESGCM.generate_key(bit_length=256)
                new_enc_key = encrypt_user_key(raw_key, new_master)
                print(f"  [{user_id}] {email}: generated new per-user key")
                if not dry_run:
                    conn.execute(
                        text("UPDATE users SET encrypted_key = :k WHERE id = :id"),
                        {"k": new_enc_key, "id": user_id},
                    )

            # Encrypt every sensitive column for this user
            total_rows = 0
            for table, columns in ENCRYPTED_COLUMNS.items():
                col_list = ", ".join(columns)
                rows = conn.execute(
                    text(f"SELECT id, {col_list} FROM {table} WHERE user_id = :uid"),
                    {"uid": user_id},
                ).fetchall()

                for row in rows:
                    row_id = row[0]
                    updates: dict[str, str] = {}
                    for i, col in enumerate(columns):
                        val = row[i + 1]
                        if val is None:
                            continue
                        val_str = str(val)
                        if val_str.startswith(_ENC_PREFIX):
                            continue  # already encrypted — idempotent
                        updates[col] = encrypt_value(val_str, raw_key)

                    if updates and not dry_run:
                        set_clause = ", ".join(f"{c} = :{c}" for c in updates)
                        updates["_id"] = row_id
                        conn.execute(
                            text(f"UPDATE {table} SET {set_clause} WHERE id = :_id"),
                            updates,
                        )

                if rows:
                    print(f"    {table}: {len(rows)} row(s)")
                    total_rows += len(rows)

        if dry_run:
            print("Dry run — no changes written.")
        else:
            print("Migration complete. All changes committed.")


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def main() -> None:
    parser = argparse.ArgumentParser(
        description=__doc__,
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    sub = parser.add_subparsers(dest="mode", required=True)

    rot = sub.add_parser("rotate-master", help="Re-wrap user keys with a new master key")
    rot.add_argument("--old-key", default=os.getenv("OLD_MASTER_KEY"), metavar="KEY")
    rot.add_argument("--new-key", default=os.getenv("NEW_MASTER_KEY"), metavar="KEY")
    rot.add_argument("--dry-run", action="store_true")

    enc = sub.add_parser("encrypt", help="Enable encryption on a plaintext database")
    enc.add_argument("--new-key", default=os.getenv("NEW_MASTER_KEY"), metavar="KEY")
    enc.add_argument("--dry-run", action="store_true")

    args = parser.parse_args()

    db_url = os.getenv("DATABASE_URL")
    if not db_url:
        print("ERROR: DATABASE_URL env var is required.", file=sys.stderr)
        raise SystemExit(1)

    engine = create_engine(db_url)

    if args.mode == "rotate-master":
        if not args.old_key:
            print("ERROR: --old-key (or OLD_MASTER_KEY) is required.", file=sys.stderr)
            raise SystemExit(1)
        if not args.new_key:
            print("ERROR: --new-key (or NEW_MASTER_KEY) is required.", file=sys.stderr)
            raise SystemExit(1)
        if args.old_key == args.new_key:
            print("ERROR: old and new master keys are identical — nothing to do.", file=sys.stderr)
            raise SystemExit(1)
        rotate_master(engine, args.old_key, args.new_key, args.dry_run)

    elif args.mode == "encrypt":
        if not args.new_key:
            print("ERROR: --new-key (or NEW_MASTER_KEY) is required.", file=sys.stderr)
            raise SystemExit(1)
        encrypt_plaintext(engine, args.new_key, args.dry_run)


if __name__ == "__main__":
    main()
