"""
The single place a user's sales get taxed.

Four call sites used to compute a sale's capital-gains tax their own way:
the timeline (/api/events, which drives the Dashboard), the per-sale
breakdown (/api/sales/{id}/tax and the bulk /api/sales/tax), payoff-sale
sizing (_compute_payoff_sale), and dashboard aggregation
(_get_dashboard_data). They disagreed, sometimes wildly, for two
independent reasons:

1. Two of them (the timeline, payoff sizing) tracked exactly which lots
   each earlier sale consumed, via compute_sale_tax's own lots_consumed,
   and removed precisely those before taxing the next sale. The other two
   (the per-sale breakdown, dashboard aggregation) approximated "prior
   sales" as a same-order reduction regardless of what those sales
   actually used — wrong the moment two sales use different lot orders
   (e.g. one same-tranche, one not), which is the common case.
2. A payoff sale (Sale.loan_id set) defaults to same-tranche — restricted
   to its own loan's grant — unless flexible payoff is enabled for the
   account and loan_payoff_method names an explicit order. Some call sites
   checked the wrong setting (lot_selection_method, which only governs
   ordinary sales) or didn't apply the restriction at all.

compute_all_sale_taxes and resolve_sale_lot_order are that one place.
Every caller listed above goes through them now, so a sale's tax can never
differ depending on which endpoint is asked.
"""
import bisect
from datetime import datetime

from app.sales_engine import compute_sale_tax, build_lots_from_overrides


def _sort_key(e: dict):
    d = e["date"]
    d = d.date() if isinstance(d, datetime) else d
    return (d, 0 if e.get("event_type") == "Vesting" else 1)


def resolve_sale_lot_order(
    loan_id: int | None,
    loan_payoff_method: str | None,
    lot_selection_method: str | None,
    flexible_payoff_enabled: bool,
    loan_grant_by_id: dict,
) -> tuple[str, int | None, int | None]:
    """(lot_order, grant_year, grant_type) for one sale.

    A payoff sale (loan_id set) draws only from its own loan's grant —
    same-tranche — unless flexible payoff is on for the account and
    loan_payoff_method names an explicit fifo/lifo/epic_lifo order. An
    ordinary sale always uses the account's lot_selection_method.
    """
    if loan_id is not None:
        method = loan_payoff_method if flexible_payoff_enabled else 'same_tranche'
        if method in ('fifo', 'lifo', 'epic_lifo'):
            return method, None, None
        gy, gt = loan_grant_by_id.get(loan_id, (None, None))
        return 'epic_lifo', gy, gt
    method = lot_selection_method if lot_selection_method in ('fifo', 'lifo', 'epic_lifo') else 'epic_lifo'
    return method, None, None


def compute_all_sale_taxes(
    timeline: list,
    sale_specs: list[dict],
    loan_grant_by_id: dict,
    loan_payoff_method: str | None,
    lot_selection_method: str | None,
    flexible_payoff_enabled: bool,
) -> tuple[dict, list]:
    """Tax every sale in `sale_specs` against a shared, mutating view of the
    timeline's lots.

    Each sale_spec: {id, date, shares, price_per_share, loan_id,
    lot_overrides, rates}. Processed in chronological order; each sale
    removes precisely the lots compute_sale_tax says it consumed
    (lots_consumed) before the next sale is evaluated, so lot availability
    never depends on which sale is asked about first.

    Returns ({sale_id: TaxBreakdown}, final_timeline) — final_timeline is
    the fully lot-sentinel-annotated timeline after every sale, for callers
    (a projected liquidation) that need to price one more hypothetical sale
    against everything real that came before it.
    """
    sorted_tl = sorted(timeline, key=_sort_key)
    sort_keys = [_sort_key(e) for e in sorted_tl]

    results: dict = {}
    for spec in sorted(sale_specs, key=lambda s: s["date"]):
        lot_order, gy, gt = resolve_sale_lot_order(
            spec.get("loan_id"), loan_payoff_method, lot_selection_method,
            flexible_payoff_enabled, loan_grant_by_id,
        )
        prebuilt = None
        if spec.get("lot_overrides"):
            prebuilt = build_lots_from_overrides(sorted_tl, spec["lot_overrides"], spec["date"])
        result = compute_sale_tax(
            sorted_tl,
            {"date": spec["date"], "shares": spec["shares"], "price_per_share": spec["price_per_share"]},
            spec["rates"], lot_order=lot_order, grant_year=gy, grant_type=gt, prebuilt_lots=prebuilt,
        )
        results[spec["id"]] = result

        sale_date = spec["date"]
        for lot in result.get("lots_consumed", []):
            sentinel = {
                "date": datetime.combine(sale_date, datetime.min.time()) if not isinstance(sale_date, datetime) else sale_date,
                "event_type": "Prior Sale Lot",
                "target_vest_date": lot["vest_date"],
                "target_grant_year": lot["grant_year"],
                "target_grant_type": lot["grant_type"],
                "shares_consumed": lot["shares"],
                "vested_shares": 0,
                "grant_price": None,
                "share_price": 0.0,
            }
            key = _sort_key(sentinel)
            idx = bisect.bisect_right(sort_keys, key)
            sorted_tl.insert(idx, sentinel)
            sort_keys.insert(idx, key)

    return results, sorted_tl
