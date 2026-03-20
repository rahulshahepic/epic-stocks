"""Seed a temporary database with sample data and print a JWT token."""
import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'backend'))

from database import Base, engine, SessionLocal
from models import User, Grant, Loan, Price
from auth import create_token
from datetime import date, datetime, timezone

Base.metadata.create_all(bind=engine)
db = SessionLocal()

user = User(email="demo@example.com", google_id="demo-screenshot", name="Demo User", picture="")
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

db.commit()
token = create_token(user.id)
print(token)
