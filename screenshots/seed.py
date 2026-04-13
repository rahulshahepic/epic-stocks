"""Seed a temporary database with sample data and print a JWT token."""
import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'backend'))

from database import Base, engine, SessionLocal
from scaffold.models import User, Grant, Loan, Price, Sale, Invitation
from scaffold.auth import create_token
from datetime import date, datetime, timezone

Base.metadata.create_all(bind=engine)
db = SessionLocal()

user = User(email="demo@example.com", google_id="test-demo@example.com", name="Demo User",
            picture="", is_admin=True, last_login=datetime(2026, 3, 20, 10, 0, tzinfo=timezone.utc))
db.add(user)
db.flush()

grants = [
    Grant(user_id=user.id, year=2018, type="Purchase", shares=15000, price=1.99,
          vest_start=date(2019, 3, 1), periods=5, exercise_date=date(2018, 12, 31), dp_shares=-500),
    Grant(user_id=user.id, year=2019, type="Purchase", shares=12000, price=2.50,
          vest_start=date(2020, 3, 1), periods=5, exercise_date=date(2019, 12, 31), dp_shares=-400),
    Grant(user_id=user.id, year=2020, type="Bonus", shares=8000, price=0.0,
          vest_start=date(2021, 3, 1), periods=5, exercise_date=date(2020, 12, 31), dp_shares=0),
    Grant(user_id=user.id, year=2021, type="Purchase", shares=10000, price=3.50,
          vest_start=date(2022, 3, 1), periods=5, exercise_date=date(2021, 12, 31), dp_shares=-300),
    Grant(user_id=user.id, year=2022, type="Bonus", shares=5000, price=0.0,
          vest_start=date(2023, 3, 1), periods=5, exercise_date=date(2022, 12, 31), dp_shares=0),
]
db.add_all(grants)

prices = [
    Price(user_id=user.id, effective_date=date(2018, 12, 31), price=1.99),
    Price(user_id=user.id, effective_date=date(2019, 3, 1), price=2.50),
    Price(user_id=user.id, effective_date=date(2020, 3, 1), price=3.00),
    Price(user_id=user.id, effective_date=date(2021, 3, 1), price=3.50),
    Price(user_id=user.id, effective_date=date(2022, 3, 1), price=5.00),
    Price(user_id=user.id, effective_date=date(2023, 3, 1), price=6.25),
    Price(user_id=user.id, effective_date=date(2024, 3, 1), price=7.50),
    Price(user_id=user.id, effective_date=date(2025, 3, 1), price=8.50),
]
db.add_all(prices)

loans = [
    Loan(user_id=user.id, grant_year=2018, grant_type="Purchase", loan_type="Purchase",
         loan_year=2018, amount=29350.0, interest_rate=3.5, due_date=date(2025, 12, 31), loan_number="100001"),
    Loan(user_id=user.id, grant_year=2018, grant_type="Purchase", loan_type="Interest",
         loan_year=2019, amount=1027.0, interest_rate=3.5, due_date=date(2025, 12, 31), loan_number="100002"),
    Loan(user_id=user.id, grant_year=2019, grant_type="Purchase", loan_type="Purchase",
         loan_year=2019, amount=29000.0, interest_rate=4.0, due_date=date(2026, 12, 31), loan_number="100003"),
    Loan(user_id=user.id, grant_year=2019, grant_type="Purchase", loan_type="Interest",
         loan_year=2020, amount=1160.0, interest_rate=4.0, due_date=date(2026, 12, 31), loan_number="100004"),
    Loan(user_id=user.id, grant_year=2021, grant_type="Purchase", loan_type="Purchase",
         loan_year=2021, amount=34500.0, interest_rate=4.5, due_date=date(2028, 12, 31), loan_number="100005"),
    Loan(user_id=user.id, grant_year=2018, grant_type="Purchase", loan_type="Tax",
         loan_year=2020, amount=4500.0, interest_rate=3.5, due_date=date(2025, 12, 31), loan_number="100006"),
    Loan(user_id=user.id, grant_year=2021, grant_type="Purchase", loan_type="Interest",
         loan_year=2022, amount=1552.0, interest_rate=4.5, due_date=date(2028, 12, 31), loan_number="100007"),
]
db.add_all(loans)
db.flush()  # need IDs for sale loan_id FKs

# Sales: a past cash-out sale and payoff sales for the 2025 loans
sales = [
    Sale(user_id=user.id, date=date(2024, 6, 15), shares=500, price_per_share=7.50,
         loan_id=None, notes="Cash out"),
    Sale(user_id=user.id, date=date(2025, 12, 31), shares=6900, price_per_share=8.50,
         loan_id=loans[0].id, notes="Payoff sale for purchase loan 100001"),
    Sale(user_id=user.id, date=date(2025, 12, 31), shares=260, price_per_share=8.50,
         loan_id=loans[1].id, notes="Payoff sale for interest loan 100002"),
    Sale(user_id=user.id, date=date(2025, 12, 31), shares=1050, price_per_share=8.50,
         loan_id=loans[5].id, notes="Payoff sale for tax loan 100006"),
]
db.add_all(sales)

# Extra users for admin screenshots
extra_users = [
    User(email="alice.johnson@company.com", google_id="alice-g", name="Alice Johnson",
         last_login=datetime(2026, 3, 19, 14, 30, tzinfo=timezone.utc),
         created_at=datetime(2025, 6, 15, tzinfo=timezone.utc)),
    User(email="bob.martinez@company.com", google_id="bob-g", name="Bob Martinez",
         last_login=datetime(2026, 3, 18, 9, 0, tzinfo=timezone.utc),
         created_at=datetime(2025, 8, 1, tzinfo=timezone.utc)),
    User(email="carol.chen@company.com", google_id="carol-g", name="Carol Chen",
         last_login=datetime(2026, 3, 15, 16, 45, tzinfo=timezone.utc),
         created_at=datetime(2025, 9, 10, tzinfo=timezone.utc)),
    User(email="dave.wilson@company.com", google_id="dave-g", name="Dave Wilson",
         last_login=datetime(2026, 2, 28, 11, 0, tzinfo=timezone.utc),
         created_at=datetime(2025, 11, 1, tzinfo=timezone.utc)),
    User(email="eva.garcia@company.com", google_id="eva-g", name="Eva Garcia",
         last_login=datetime(2026, 1, 10, 8, 0, tzinfo=timezone.utc),
         created_at=datetime(2026, 1, 5, tzinfo=timezone.utc)),
    User(email="frank.lee@external.io", google_id="frank-g", name="Frank Lee",
         last_login=None,
         created_at=datetime(2026, 3, 1, tzinfo=timezone.utc)),
]
db.add_all(extra_users)
db.flush()

# Give some extra users sample data counts
for i, eu in enumerate(extra_users[:3]):
    for j in range(i + 1):
        db.add(Grant(user_id=eu.id, year=2020+j, type="Purchase", shares=1000*(j+1), price=2.0+j,
                     vest_start=date(2021+j, 3, 1), periods=5, exercise_date=date(2020+j, 12, 31), dp_shares=0))
    for j in range(i):
        db.add(Price(user_id=eu.id, effective_date=date(2021+j, 3, 1), price=3.0+j))

# Invitations for sharing screenshots
invitations = [
    Invitation(inviter_id=user.id, invitee_email="advisor@wealth.com",
               token="screenshot-token-1", short_code="ABCD1234",
               status="accepted", invitee_id=extra_users[0].id,
               invitee_account_email="alice.johnson@company.com",
               expires_at=datetime(2026, 4, 20, tzinfo=timezone.utc),
               accepted_at=datetime(2026, 4, 5, 10, 0, tzinfo=timezone.utc),
               last_viewed_at=datetime(2026, 4, 11, 14, 30, tzinfo=timezone.utc)),
    Invitation(inviter_id=user.id, invitee_email="spouse@family.com",
               token="screenshot-token-2", short_code="EFGH5678",
               status="pending",
               expires_at=datetime(2026, 4, 20, tzinfo=timezone.utc)),
    # Alice shared her data with the demo user
    Invitation(inviter_id=extra_users[0].id, invitee_email="demo@example.com",
               token="screenshot-token-3", short_code="JKLM9012",
               status="accepted", invitee_id=user.id,
               invitee_account_email="demo@example.com",
               expires_at=datetime(2026, 4, 20, tzinfo=timezone.utc),
               accepted_at=datetime(2026, 4, 3, 8, 0, tzinfo=timezone.utc),
               last_viewed_at=datetime(2026, 4, 10, 9, 0, tzinfo=timezone.utc)),
]
db.add_all(invitations)

db.commit()
token = create_token(user.id)
print(token)
