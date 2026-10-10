"""Price certainty is independent of the date a valuation applies."""
from datetime import date, datetime


def price_values(values: dict, existing=None, today: date | None = None) -> dict:
    today = today or date.today()
    effective = values.get("effective_date", getattr(existing, "effective_date", None))
    if isinstance(effective, datetime):
        effective = effective.date()
    if isinstance(effective, str):
        effective = date.fromisoformat(effective)
    announced = values.get("announced_date", getattr(existing, "announced_date", None))
    expected = values.get("expected_announcement_date", getattr(existing, "expected_announcement_date", None))
    if isinstance(announced, datetime):
        announced = announced.date()
    if isinstance(expected, datetime):
        expected = expected.date()
    if isinstance(announced, str):
        announced = date.fromisoformat(announced) if announced else None
    if isinstance(expected, str):
        expected = date.fromisoformat(expected) if expected else None
    if not isinstance(effective, date):
        raise ValueError("Applicable date must be a valid date")
    if announced is not None and not isinstance(announced, date):
        raise ValueError("Actual announcement date must be a valid date")
    if expected is not None and not isinstance(expected, date):
        raise ValueError("Expected announcement date must be a valid date")
    estimate = values.get("is_estimate")
    if estimate is not None and type(estimate) is not bool:
        raise ValueError("is_estimate must be a boolean")
    if estimate is None:
        if announced is not None:
            estimate = False
        elif existing is not None:
            estimate = existing.is_estimate
        else:
            # Compatibility for older clients and two-column workbooks.
            estimate = effective > today
    if announced and announced > today:
        raise ValueError("Actual announcement date cannot be in the future; use expected announcement date")
    if estimate and announced:
        if values.get("is_estimate") is True and "announced_date" not in values:
            announced = None
        else:
            raise ValueError("A tentative price cannot have an actual announcement date")
    if estimate and expected is None:
        expected = date(effective.year, 3, 1)
    return {"effective_date": effective, "is_estimate": estimate,
            "expected_announcement_date": expected, "announced_date": announced}


def price_metadata(price, as_of: date | None = None) -> dict:
    cutoff = as_of or date.today()
    announced = price.announced_date
    tentative = bool(price.is_estimate or (announced and announced > cutoff))
    expected = price.expected_announcement_date or (date(price.effective_date.year, 3, 1) if tentative else None)
    return {"price_is_estimate": tentative,
            "price_effective_date": price.effective_date.isoformat(),
            "expected_announcement_date": expected.isoformat() if expected else None,
            "announced_date": announced.isoformat() if announced else None}


def notification_details(events: list[dict]) -> list[str]:
    details = []
    for event in events:
        if event.get("event_type") == "Price Announcement":
            details.append(f"Share price confirmed, effective {event['price_effective_date']}" +
                           (f" (announced {event['announced_date']})." if event.get("announced_date") else "."))
        elif event.get("price_is_estimate"):
            expected = event.get("expected_announcement_date")
            details.append("Monetary values use a tentative share price" +
                           (f"; announcement expected {expected}." if expected else "."))
    return list(dict.fromkeys(details))
