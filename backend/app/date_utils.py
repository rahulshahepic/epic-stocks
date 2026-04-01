from datetime import date, datetime


def to_date(d) -> date:
    """Normalise any date-like value to datetime.date.

    Handles:
      - datetime objects  (e.g. from datetime.combine or SQLAlchemy DateTime)
      - date objects      (pass-through)
      - ISO strings       ('2021-03-01' or '2021-03-01 00:00:00' from Redis)
    """
    if isinstance(d, datetime):
        return d.date()
    if isinstance(d, str):
        return date.fromisoformat(d[:10])
    return d
