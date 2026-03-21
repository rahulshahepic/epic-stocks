from datetime import datetime, date, timezone
from sqlalchemy import Integer, String, Float, Date, DateTime, ForeignKey
from sqlalchemy.orm import Mapped, mapped_column, relationship
from database import Base
from crypto import EncryptedFloat, EncryptedInt, EncryptedString


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
    is_admin: Mapped[bool] = mapped_column(Integer, default=0, server_default="0")
    last_notified_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)

    grants: Mapped[list["Grant"]] = relationship(back_populates="user", cascade="all, delete-orphan")
    loans: Mapped[list["Loan"]] = relationship(back_populates="user", cascade="all, delete-orphan")
    prices: Mapped[list["Price"]] = relationship(back_populates="user", cascade="all, delete-orphan")
    push_subscriptions: Mapped[list["PushSubscription"]] = relationship(back_populates="user", cascade="all, delete-orphan")
    email_preference: Mapped["EmailPreference | None"] = relationship(back_populates="user", cascade="all, delete-orphan", uselist=False)


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
    version: Mapped[int] = mapped_column(Integer, default=1, server_default="1", nullable=False)

    user: Mapped["User"] = relationship(back_populates="loans")


class Price(Base):
    __tablename__ = "prices"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    effective_date: Mapped[date] = mapped_column(Date, nullable=False)
    price: Mapped[float] = mapped_column(EncryptedFloat, nullable=False)
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
    enabled: Mapped[bool] = mapped_column(Integer, default=1, server_default="1")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=lambda: datetime.now(timezone.utc))

    user: Mapped["User"] = relationship(back_populates="email_preference")


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
