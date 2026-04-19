from datetime import datetime, date, timezone
from sqlalchemy import Integer, String, Float, BigInteger, Date, DateTime, ForeignKey, Boolean, JSON, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship
from database import Base
from scaffold.crypto import EncryptedFloat, EncryptedInt, EncryptedString


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    email: Mapped[str] = mapped_column(String, unique=True, nullable=False, index=True)
    google_id: Mapped[str] = mapped_column(String, unique=True, nullable=False, index=True)
    name: Mapped[str] = mapped_column(String, nullable=True)
    picture: Mapped[str] = mapped_column(String, nullable=True)
    encrypted_key: Mapped[str | None] = mapped_column(String, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=lambda: datetime.now(timezone.utc))
    last_login: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    is_admin: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    is_content_admin: Mapped[int] = mapped_column(Integer, default=0, server_default="0", nullable=False)
    last_notified_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)

    grants: Mapped[list["Grant"]] = relationship(back_populates="user", cascade="all, delete-orphan")
    loans: Mapped[list["Loan"]] = relationship(back_populates="user", cascade="all, delete-orphan")
    prices: Mapped[list["Price"]] = relationship(back_populates="user", cascade="all, delete-orphan")
    push_subscriptions: Mapped[list["PushSubscription"]] = relationship(back_populates="user", cascade="all, delete-orphan")
    email_preference: Mapped["EmailPreference | None"] = relationship(back_populates="user", cascade="all, delete-orphan", uselist=False)
    sales: Mapped[list["Sale"]] = relationship(back_populates="user", cascade="all, delete-orphan")
    loan_payments: Mapped[list["LoanPayment"]] = relationship(back_populates="user", cascade="all, delete-orphan")
    tax_settings: Mapped["TaxSettings | None"] = relationship(back_populates="user", cascade="all, delete-orphan", uselist=False)
    sent_invitations: Mapped[list["Invitation"]] = relationship(foreign_keys="[Invitation.inviter_id]", back_populates="inviter", cascade="all, delete-orphan")
    received_invitations: Mapped[list["Invitation"]] = relationship(foreign_keys="[Invitation.invitee_id]", back_populates="invitee")


class Grant(Base):
    __tablename__ = "grants"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    year: Mapped[int] = mapped_column(Integer, nullable=False)
    type: Mapped[str] = mapped_column(String, nullable=False)
    shares: Mapped[int] = mapped_column(EncryptedInt, nullable=False)
    price: Mapped[float] = mapped_column(EncryptedFloat, nullable=False)
    vest_start: Mapped[date] = mapped_column(Date, nullable=False)
    periods: Mapped[int] = mapped_column(Integer, nullable=False)
    exercise_date: Mapped[date] = mapped_column(Date, nullable=False)
    dp_shares: Mapped[int] = mapped_column(EncryptedInt, default=0)
    election_83b: Mapped[bool] = mapped_column(Boolean, default=False, server_default="0", nullable=False)
    version: Mapped[int] = mapped_column(Integer, default=1, server_default="1", nullable=False)

    user: Mapped["User"] = relationship(back_populates="grants")


class Loan(Base):
    __tablename__ = "loans"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    grant_year: Mapped[int] = mapped_column(Integer, nullable=False)
    grant_type: Mapped[str] = mapped_column(String, nullable=False)
    loan_type: Mapped[str] = mapped_column(String, nullable=False)
    loan_year: Mapped[int] = mapped_column(Integer, nullable=False)
    amount: Mapped[float] = mapped_column(EncryptedFloat, nullable=False)
    interest_rate: Mapped[float] = mapped_column(EncryptedFloat, nullable=False)
    due_date: Mapped[date] = mapped_column(Date, nullable=False)
    loan_number: Mapped[str] = mapped_column(EncryptedString, nullable=True)
    refinances_loan_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("loans.id"), nullable=True)
    version: Mapped[int] = mapped_column(Integer, default=1, server_default="1", nullable=False)

    user: Mapped["User"] = relationship(back_populates="loans")


class Price(Base):
    __tablename__ = "prices"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    effective_date: Mapped[date] = mapped_column(Date, nullable=False)
    price: Mapped[float] = mapped_column(EncryptedFloat, nullable=False)
    is_estimate: Mapped[bool] = mapped_column(Boolean, default=False, server_default="0", nullable=False)
    version: Mapped[int] = mapped_column(Integer, default=1, server_default="1", nullable=False)

    user: Mapped["User"] = relationship(back_populates="prices")


class PushSubscription(Base):
    __tablename__ = "push_subscriptions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    endpoint: Mapped[str] = mapped_column(String, nullable=False, unique=True)
    p256dh: Mapped[str] = mapped_column(String, nullable=False)
    auth: Mapped[str] = mapped_column(String, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=lambda: datetime.now(timezone.utc))

    user: Mapped["User"] = relationship(back_populates="push_subscriptions")


class EmailPreference(Base):
    __tablename__ = "email_preferences"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(Integer, ForeignKey("users.id"), nullable=False, unique=True, index=True)
    enabled: Mapped[int] = mapped_column(Integer, default=1, server_default="1")
    advance_days: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=lambda: datetime.now(timezone.utc))

    user: Mapped["User"] = relationship(back_populates="email_preference")


class Sale(Base):
    __tablename__ = "sales"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    date: Mapped[date] = mapped_column(Date, nullable=False)
    shares: Mapped[int] = mapped_column(Integer, nullable=False)
    price_per_share: Mapped[float] = mapped_column(EncryptedFloat, nullable=False)
    notes: Mapped[str] = mapped_column(String, nullable=False, default="")
    # If set, this sale was generated to cover this loan's payoff.
    loan_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("loans.id", ondelete="SET NULL"), nullable=True, index=True)
    version: Mapped[int] = mapped_column(Integer, default=1, server_default="1", nullable=False)
    # Per-sale tax rate overrides (null = fall back to user's TaxSettings)
    federal_income_rate: Mapped[float | None] = mapped_column(EncryptedFloat, nullable=True)
    federal_lt_cg_rate: Mapped[float | None] = mapped_column(EncryptedFloat, nullable=True)
    federal_st_cg_rate: Mapped[float | None] = mapped_column(EncryptedFloat, nullable=True)
    niit_rate: Mapped[float | None] = mapped_column(EncryptedFloat, nullable=True)
    state_income_rate: Mapped[float | None] = mapped_column(EncryptedFloat, nullable=True)
    state_lt_cg_rate: Mapped[float | None] = mapped_column(EncryptedFloat, nullable=True)
    state_st_cg_rate: Mapped[float | None] = mapped_column(EncryptedFloat, nullable=True)
    lt_holding_days: Mapped[int | None] = mapped_column(Integer, nullable=True)
    # Manual lot allocation: [{vest_date, grant_year, grant_type, basis_price, shares}, ...]
    lot_overrides: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    # Groups related sales created together (e.g. payoff + cash-out from one plan)
    sale_plan_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    # User-recorded actual tax paid; overrides estimated tax in display for past sales
    actual_tax_paid: Mapped[float | None] = mapped_column(Float, nullable=True)

    user: Mapped["User"] = relationship(back_populates="sales")


class LoanPayment(Base):
    """User-recorded early cash payment against a loan (reduces final payoff balance)."""
    __tablename__ = "loan_payments"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    loan_id: Mapped[int] = mapped_column(Integer, ForeignKey("loans.id", ondelete="CASCADE"), nullable=False, index=True)
    date: Mapped[date] = mapped_column(Date, nullable=False)
    amount: Mapped[float] = mapped_column(EncryptedFloat, nullable=False)
    notes: Mapped[str] = mapped_column(String, nullable=False, default="")
    version: Mapped[int] = mapped_column(Integer, default=1, server_default="1", nullable=False)

    user: Mapped["User"] = relationship(back_populates="loan_payments")


class TaxSettings(Base):
    __tablename__ = "tax_settings"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(Integer, ForeignKey("users.id"), nullable=False, unique=True, index=True)
    federal_income_rate: Mapped[float] = mapped_column(EncryptedFloat, nullable=False, default=0.37)
    federal_lt_cg_rate: Mapped[float] = mapped_column(EncryptedFloat, nullable=False, default=0.20)
    federal_st_cg_rate: Mapped[float] = mapped_column(EncryptedFloat, nullable=False, default=0.37)
    niit_rate: Mapped[float] = mapped_column(EncryptedFloat, nullable=False, default=0.038)
    state_income_rate: Mapped[float] = mapped_column(EncryptedFloat, nullable=False, default=0.0765)
    state_lt_cg_rate: Mapped[float] = mapped_column(EncryptedFloat, nullable=False, default=0.0536)
    state_st_cg_rate: Mapped[float] = mapped_column(EncryptedFloat, nullable=False, default=0.0765)
    lt_holding_days: Mapped[int] = mapped_column(Integer, nullable=False, default=365)
    lot_selection_method: Mapped[str] = mapped_column(String, nullable=False, default='lifo')
    loan_payoff_method: Mapped[str] = mapped_column(String, nullable=False, default='epic_lifo')
    prefer_stock_dp: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    deduct_investment_interest: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default="0")
    deduction_excluded_years: Mapped[list | None] = mapped_column(JSON, nullable=True, default=None)

    user: Mapped["User"] = relationship(back_populates="tax_settings")


class ImportBackup(Base):
    """Snapshot of user data taken immediately before an import, for recovery."""
    __tablename__ = "import_backups"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=lambda: datetime.now(timezone.utc), index=True)
    # JSON snapshot: {"grants": [...], "prices": [...], "loans": [...]}
    data_json: Mapped[str] = mapped_column(String, nullable=False)


class BlockedEmail(Base):
    __tablename__ = "blocked_emails"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    email: Mapped[str] = mapped_column(String, unique=True, nullable=False, index=True)
    reason: Mapped[str] = mapped_column(String, nullable=True)
    blocked_at: Mapped[datetime] = mapped_column(DateTime, default=lambda: datetime.now(timezone.utc))


class ErrorLog(Base):
    __tablename__ = "error_logs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    timestamp: Mapped[datetime] = mapped_column(DateTime, default=lambda: datetime.now(timezone.utc), index=True)
    method: Mapped[str] = mapped_column(String, nullable=True)
    path: Mapped[str] = mapped_column(String, nullable=True)
    error_type: Mapped[str] = mapped_column(String, nullable=True)
    error_message: Mapped[str] = mapped_column(String, nullable=True)
    traceback: Mapped[str] = mapped_column(String, nullable=True)
    user_id: Mapped[int | None] = mapped_column(Integer, nullable=True)


class SystemMetric(Base):
    """Periodic system health snapshot (CPU, RAM, DB size).

    Raw 15-min samples are kept for 30 days.  A nightly job then aggregates each
    completed UTC day into a single row (aggregated=True) and deletes the raw
    rows.  Aggregated rows are purged after 1 year.
    """
    __tablename__ = "system_metrics"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    timestamp: Mapped[datetime] = mapped_column(DateTime, default=lambda: datetime.now(timezone.utc), index=True)
    aggregated: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default="false")
    cpu_percent: Mapped[float] = mapped_column(Float, nullable=False)
    ram_used_mb: Mapped[float] = mapped_column(Float, nullable=False)
    ram_total_mb: Mapped[float] = mapped_column(Float, nullable=False)
    db_size_bytes: Mapped[int] = mapped_column(BigInteger, nullable=False)
    error_log_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    cache_l1_hits: Mapped[int | None] = mapped_column(Integer, nullable=True)
    cache_l2_hits: Mapped[int | None] = mapped_column(Integer, nullable=True)
    cache_misses: Mapped[int | None] = mapped_column(Integer, nullable=True)
    cache_l2_key_count: Mapped[int | None] = mapped_column(Integer, nullable=True)


class TipAcceptance(Base):
    __tablename__ = "tip_acceptances"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    tip_type: Mapped[str] = mapped_column(String, nullable=False)
    savings_estimate: Mapped[float] = mapped_column(Float, nullable=False)
    accepted_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    __table_args__ = (
        UniqueConstraint('user_id', 'tip_type', name='uq_tip_acceptance_user_type'),
    )


class SystemSettings(Base):
    """Key-value store for shared operational state across all replicas.

    Rows used by the application:
      maintenance_active  – 'true' / 'false' (app-level maintenance toggle)
      master_key          – KEK-encrypted operational encryption master key
      master_key_version  – integer string, incremented on each key rotation
      rotation_snapshot   – JSON blob {uid: encrypted_key} written before rotation
                            for crash recovery; deleted on success or rollback
    """
    __tablename__ = "system_settings"

    key: Mapped[str] = mapped_column(String, primary_key=True)
    value: Mapped[str] = mapped_column(String, nullable=False)


class Invitation(Base):
    """An invitation from one user to another to view their financial data (read-only)."""
    __tablename__ = "invitations"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    inviter_id: Mapped[int] = mapped_column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    invitee_email: Mapped[str] = mapped_column(String, nullable=False)
    token: Mapped[str] = mapped_column(String, unique=True, nullable=False, index=True)
    short_code: Mapped[str] = mapped_column(String, unique=True, nullable=False, index=True)
    status: Mapped[str] = mapped_column(String, nullable=False, default="pending")
    invitee_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True)
    invitee_account_email: Mapped[str | None] = mapped_column(String, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=lambda: datetime.now(timezone.utc))
    expires_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    accepted_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    last_viewed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    last_sent_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    notify_enabled: Mapped[int] = mapped_column(Integer, default=1, server_default="1")

    inviter: Mapped["User"] = relationship(foreign_keys=[inviter_id], back_populates="sent_invitations")
    invitee: Mapped["User | None"] = relationship(foreign_keys=[invitee_id], back_populates="received_invitations")

    __table_args__ = (
        UniqueConstraint('inviter_id', 'invitee_email', name='uq_invitation_inviter_email'),
    )


class InvitationOptOut(Base):
    """Email addresses that have opted out of receiving invitation emails."""
    __tablename__ = "invitation_opt_outs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    email: Mapped[str] = mapped_column(String, unique=True, nullable=False, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=lambda: datetime.now(timezone.utc))


class InviteSendingBlock(Base):
    """Users blocked from sending new invitations (admin-managed)."""
    __tablename__ = "invite_sending_blocks"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, unique=True, index=True)
    reason: Mapped[str] = mapped_column(String, nullable=True)
    blocked_at: Mapped[datetime] = mapped_column(DateTime, default=lambda: datetime.now(timezone.utc))


# ── Grant program templates + rates (editable by content admins in Phase 2) ──

class GrantTemplate(Base):
    """Pre-filled defaults for one (year, type) row in the company's grant schedule."""
    __tablename__ = "grant_templates"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    year: Mapped[int] = mapped_column(Integer, nullable=False)
    type: Mapped[str] = mapped_column(String, nullable=False)
    vest_start: Mapped[str] = mapped_column(String, nullable=False)       # YYYY-MM-DD
    periods: Mapped[int] = mapped_column(Integer, nullable=False)
    exercise_date: Mapped[str] = mapped_column(String, nullable=False)    # YYYY-MM-DD
    default_catch_up: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default="0")
    show_dp_shares: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default="0")
    display_order: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True, server_default="1")
    notes: Mapped[str | None] = mapped_column(String, nullable=True)

    __table_args__ = (
        UniqueConstraint('year', 'type', name='uq_grant_template_year_type'),
    )


class GrantTypeDef(Base):
    """Grant type metadata (color + description + pre-tax heuristic) driving the type picker."""
    __tablename__ = "grant_type_defs"

    name: Mapped[str] = mapped_column(String, primary_key=True)
    color_class: Mapped[str] = mapped_column(String, nullable=False)
    description: Mapped[str] = mapped_column(String, nullable=False)
    is_pre_tax_when_zero_price: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default="0")
    display_order: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True, server_default="1")


class BonusScheduleVariant(Base):
    """Alternate vesting schedules per (grant_year, grant_type) — e.g. 2020 Bonus A/B/C."""
    __tablename__ = "bonus_schedule_variants"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    grant_year: Mapped[int] = mapped_column(Integer, nullable=False)
    grant_type: Mapped[str] = mapped_column(String, nullable=False)
    variant_code: Mapped[str] = mapped_column(String, nullable=False)
    periods: Mapped[int] = mapped_column(Integer, nullable=False)
    label: Mapped[str] = mapped_column(String, nullable=False, default="")
    is_default: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default="0")

    __table_args__ = (
        UniqueConstraint('grant_year', 'grant_type', 'variant_code', name='uq_bonus_variant'),
    )


class LoanRate(Base):
    """Historical loan rate rows. loan_kind ∈ {interest, tax, purchase_original}.

      interest          — one row per year, grant_type is NULL
      tax               — one row per (grant_type, year)
      purchase_original — one row per year (original purchase-loan rate + due date), grant_type is NULL
    """
    __tablename__ = "loan_rates"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    loan_kind: Mapped[str] = mapped_column(String, nullable=False)
    grant_type: Mapped[str | None] = mapped_column(String, nullable=True)
    year: Mapped[int] = mapped_column(Integer, nullable=False)
    rate: Mapped[float] = mapped_column(Float, nullable=False)
    due_date: Mapped[str | None] = mapped_column(String, nullable=True)  # YYYY-MM-DD, only for purchase_original

    __table_args__ = (
        UniqueConstraint('loan_kind', 'grant_type', 'year', name='uq_loan_rate'),
    )


class LoanRefinance(Base):
    """One entry in a loan refinance chain. chain_kind ∈ {purchase, tax}.

      purchase — grant_type is always 'Purchase'; grouped by grant_year
      tax      — grouped by (grant_year, grant_type); orig_loan_year identifies the
                 originating vest year of the tax loan being refinanced
    """
    __tablename__ = "loan_refinances"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    chain_kind: Mapped[str] = mapped_column(String, nullable=False)
    grant_year: Mapped[int] = mapped_column(Integer, nullable=False)
    grant_type: Mapped[str | None] = mapped_column(String, nullable=True)
    # For tax chains, the originating vest year of the tax loan.  Unused for purchase chains.
    orig_loan_year: Mapped[int | None] = mapped_column(Integer, nullable=True)
    order_idx: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    date: Mapped[str] = mapped_column(String, nullable=False)              # YYYY-MM-DD refi date
    rate: Mapped[float] = mapped_column(Float, nullable=False)
    loan_year: Mapped[int] = mapped_column(Integer, nullable=False)
    due_date: Mapped[str] = mapped_column(String, nullable=False)          # YYYY-MM-DD new due date after refi
    orig_due_date: Mapped[str | None] = mapped_column(String, nullable=True)  # tax only: prior due date before refi


class GrantProgramSettings(Base):
    """Singleton row (id=1) holding company-wide defaults for the equity grant program.

    Year ranges (price_years_start/end) are derived from grant_templates / loan_rates
    at read time. Loan due dates live on loan_rates / loan_refinances rows and are
    propagated via code (e.g. interest loans inherit their parent loan's due date).
    """
    __tablename__ = "grant_program_settings"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    tax_fallback_federal: Mapped[float] = mapped_column(Float, nullable=False, default=0.37, server_default="0.37")
    tax_fallback_state: Mapped[float] = mapped_column(Float, nullable=False, default=0.0765, server_default="0.0765")
    # Company-wide down-payment policy (Epic: ≥ 10% of purchase, capped at $20k).
    dp_min_percent: Mapped[float] = mapped_column(Float, nullable=False, default=0.10, server_default="0.1")
    dp_min_cap: Mapped[float] = mapped_column(Float, nullable=False, default=20000.0, server_default="20000")
    flexible_payoff_enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default="0")
