"""Document-to-chat workflows without needing the app's import wizard."""
import os
import sys

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from tests.conftest import register_user
from tests.test_mcp_tools import Mcp


@pytest.fixture
def assistant(client):
    register_user(client)
    return Mcp(client)


@pytest.mark.parametrize("label,price,vest_start,periods", [
    ("Special Purchase", 3.0, "2027-09-30", 4),
    ("Developer Recognition", 0, "2028-03-31", 3),
    ("Purchase", 2.0, "2028-09-30", 5),  # leave moved first vest date
    ("Catch-Up Extraordinary", 0, "2029-06-30", 2),
])
def test_custom_award_and_leave_changes_entered_in_chat(
        assistant, label, price, vest_start, periods):
    grant = assistant.call("save_equity", kind="grant", values={
        "year": 2025, "type": label, "shares": 1000, "price": price,
        "vest_start": vest_start, "periods": periods,
        "exercise_date": "2025-12-31",
    })
    assert grant["id"]
    rows = assistant.call("list_grants")["grants"]
    assert any(g["type"] == label and str(g["vest_start"]) == vest_start and
               g["periods"] == periods and g["price"] == price for g in rows)


def test_sales_are_individual_transactions_and_existing_history_survives(assistant):
    assistant.call("save_equity", kind="grant", values={
        "year": 2020, "type": "Bonus", "shares": 5000, "price": 0,
        "vest_start": "2021-03-31", "periods": 2,
        "exercise_date": "2020-12-31",
    })
    for when, count, price in [("2023-06-01", 100, 4.0),
                               ("2024-05-03", 125, 5.5)]:
        assistant.call("save_equity", kind="sale", values={
            "date": when, "shares": count, "price_per_share": price,
        })
    rows = assistant.call("list_sales")["sales"]
    assert len(rows) == 2
    original = rows[0]
    assistant.call("save_equity", kind="sale", id=rows[1]["id"], values={
        "version": rows[1]["version"], "shares": 120,
    })
    rows = assistant.call("list_sales")["sales"]
    assert any(s["id"] == original["id"] for s in rows)
    assert any(s["shares"] == 120 for s in rows)


def test_leave_adjustment_does_not_replace_other_grants_or_loans(assistant):
    for year in (2020, 2021):
        assistant.call("save_equity", kind="grant", values={
            "year": year, "type": "Purchase", "shares": 1000,
            "price": 1.0, "vest_start": f"{year + 1}-09-30",
            "periods": 5, "exercise_date": f"{year}-12-31",
        })
    assistant.call("save_equity", kind="loan", values={
        "grant_year": 2020, "grant_type": "Purchase", "loan_type": "Purchase",
        "loan_year": 2020, "amount": 1000, "interest_rate": 0.02,
        "due_date": "2028-07-15",
    })
    target = next(g for g in assistant.call("list_grants")["grants"] if g["year"] == 2021)
    assistant.call("save_equity", kind="grant", id=target["id"], values={
        "version": target["version"], "vest_start": "2023-09-30", "periods": 4,
    })
    assert len(assistant.call("list_grants")["grants"]) == 2
    assert len(assistant.call("list_loans")["loans"]) == 1


def test_stale_edit_and_removal_are_refused(assistant):
    row = assistant.call("save_equity", kind="grant", values={
        "year": 2025, "type": "Free", "shares": 100, "price": 0,
        "vest_start": "2026-01-01", "periods": 2,
        "exercise_date": "2025-12-31",
    })
    assistant.call("save_equity", kind="grant", id=row["id"], values={
        "version": row["version"], "shares": 120,
    })
    assert "changed" in assistant.error("save_equity", kind="grant", id=row["id"],
                                        values={"version": row["version"], "shares": 110})
    assert "changed" in assistant.error("remove_equity", kind="grant", id=row["id"],
                                        version=row["version"])
    current = assistant.call("list_grants")["grants"][0]
    assistant.call("remove_equity", kind="grant", id=row["id"], version=current["version"])
    assert assistant.call("list_grants")["grants"] == []


def test_chat_corrects_loan_due_date_and_price_without_touching_other_rows(assistant):
    assistant.call("save_equity", kind="grant", values={
        "year": 2022, "type": "Purchase", "shares": 1000, "price": 2,
        "vest_start": "2023-09-30", "periods": 4,
        "exercise_date": "2022-12-31",
    })
    loan = assistant.call("save_equity", kind="loan", values={
        "grant_year": 2022, "grant_type": "Purchase", "loan_type": "Purchase",
        "loan_year": 2022, "amount": 2000, "interest_rate": 0.025,
        "due_date": "2030-07-15",
    })
    price = assistant.call("save_equity", kind="price", values={
        "effective_date": "2022-01-01", "price": 2,
    })
    assistant.call("save_equity", kind="loan", id=loan["id"], values={
        "version": loan["version"], "due_date": "2031-07-15",
    })
    assistant.call("save_equity", kind="price", id=price["id"], values={
        "version": price["version"], "price": 2.5,
    })
    assert str(assistant.call("list_loans")["loans"][0]["due_date"]) == "2031-07-15"
    assert assistant.call("list_prices", include_projections=True)["prices"][0]["price"] == 2.5


def test_chat_rejects_a_sale_missing_actual_transaction_details(assistant):
    message = assistant.error("save_equity", kind="sale", values={"shares": 100})
    assert "date" in message and "price_per_share" in message


def test_chat_rejects_a_loan_without_its_grant(assistant):
    message = assistant.error("save_equity", kind="loan", values={
        "grant_year": 2022, "grant_type": "Unknown", "loan_type": "Purchase",
        "loan_year": 2022, "amount": 1000, "interest_rate": 0.02,
        "due_date": "2030-07-15",
    })
    assert "grant" in message.lower()


def test_read_only_connection_cannot_write(client):
    register_user(client)
    assistant = Mcp(client, scope="equity:read")
    assert "save_equity" not in {t["name"] for t in assistant.list_tools()}
    assert "equity:write" in assistant.error("save_equity", kind="sale", values={})


def test_custom_import_needs_schedule_and_basis_confirmation(assistant, client):
    payload = {"grants": [{
        "year": 2025, "type": "Special Purchase", "shares": 1000,
        "price": 2, "custom_schedule": True,
        "vest_start": "2028-09-30", "periods": 4,
        "exercise_date": "2025-12-31",
    }]}
    incomplete = assistant.call("stage_import", payload=payload)
    assert incomplete["blocked"]
    assert any(f["code"] == "R1" for f in incomplete["findings"])
    assert incomplete["prepared"]["grants"] == []
    payload["grants"][0].update(schedule_confirmed=True, basis_confirmed=True)
    staged = assistant.call("stage_import", payload=payload)
    grant = staged["prepared"]["grants"][0]
    assert grant["vest_start"] == "2028-09-30"
    assert grant["periods"] == 4
    assert grant["price"] == 2
    proposal = client.get("/api/import/proposal").json()
    assert proposal["wizard_prefill"]["grants"][0]["vest_start"] == "2028-09-30"


def test_unanswered_sales_remain_in_the_review_draft(assistant, client):
    payload = {"grants": [{
        "year": 2021, "type": "Purchase", "shares": 1000, "price": 2,
    }], "sales": [{"shares": 100, "date": None, "price_per_share": None}]}
    result = assistant.call("stage_import", payload=payload)
    assert result["prepared"]["sales"][0]["shares"] == 100
    proposal = client.get("/api/import/proposal").json()
    assert proposal["wizard_prefill"]["sales"][0]["needs_input"] is True


def test_unconfirmed_template_override_does_not_silently_change_schedule(assistant):
    guide = assistant.call("get_import_guide")
    assert "custom_schedule" in guide["how_to_submit"]
    payload = {"grants": [{
        "year": 2021, "type": "Purchase", "shares": 1000, "price": 2,
        "vest_start": "2030-09-30", "periods": 10,
    }]}
    result = assistant.call("stage_import", payload=payload)
    assert result["prepared"]["grants"][0]["vest_start"] != "2030-09-30"
    assert any(f["code"] == "C10" for f in result["findings"])


def test_unknown_type_without_confirmed_schedule_cannot_use_placeholder(assistant):
    result = assistant.call("stage_import", payload={"grants": [{
        "year": 2025, "type": "Novel Award", "shares": 100, "price": 0,
    }]})
    assert result["blocked"]
    assert any(f["code"] == "S1" and f["severity"] == "error" for f in result["findings"])


@pytest.mark.parametrize("label", ["2025 Special Purchase", "2019 Purchased Conversion"])
def test_a_similar_unknown_label_is_a_hint_not_a_blocking_grant(label):
    """Historic conversion rows look like a type and are not grants. A file
    upload has no way to confirm a guessed award in the app, so the guess must
    not block the rest of the import."""
    from datetime import date
    from app.epic_import.draft import derive_draft, is_blocked
    from app.epic_import.models import ShareRow
    from app.epic_import.skeleton import Skeleton, TemplateRow

    skeleton = Skeleton(templates=[TemplateRow(
        2024, "Purchase", date(2025, 9, 30), 4, date(2024, 12, 31))])
    row = ShareRow(label=label, shares_granted=100,
                   shares_sold=0, shares_remaining=100, shares_83b=0,
                   cost_basis=200, loan_balance=None, loan_due_year=None,
                   vested=[], unvested_value=[], annual_interest_due=None)
    draft, findings = derive_draft(None, [row], skeleton)
    assert draft.grants == []
    g1 = [f for f in findings if f.code == "G1"]
    assert "not imported" in g1[0].message and "'purchase'" in g1[0].message
    assert not is_blocked(findings)
