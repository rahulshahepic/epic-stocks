"""
Sales tax computation engine.
FIFO cost basis allocation for vested share lots.
Does NOT modify core.py.
"""
import math
from collections import deque
from datetime import date, datetime


def _to_date(d) -> date:
    if isinstance(d, datetime):
        return d.date()
    return d


def build_fifo_lots(
    timeline_events,
    as_of: date,
    order: str = 'fifo',
    grant_year: int | None = None,
    grant_type: str | None = None,
) -> deque:
    """
    Build a lot queue from timeline events up to as_of date.

    Each lot item: [vest_date, shares_remaining, basis_price, grant_year, grant_type]

    basis_price:
      - Purchase grants (grant_price > 0): original purchase price (no step-up at vest).
      - Income/RSU grants (grant_price = 0/None): FMV at vest (basis after income recognition).

    order: 'fifo' (oldest first) or 'lifo' (newest first). Reductions in the timeline
    (loan repayments, dp exchanges) are always applied oldest-first regardless of order.

    grant_year / grant_type: when both provided, only lots from that grant are returned
    (same-tranche selection). Falls back gracefully if no matching lots exist.
    """
    lots: deque = deque()  # [vest_date, shares_remaining, basis_price, grant_year, grant_type]

    for e in timeline_events:
        edate = _to_date(e["date"])
        if edate > as_of:
            break

        vs = e.get("vested_shares") or 0

        if e["event_type"] == "Vesting" and vs > 0:
            basis = e.get("grant_price") or e.get("share_price", 0.0)
            lots.append([edate, vs, basis, e.get("grant_year"), e.get("grant_type")])
        elif vs < 0:
            # Reductions always consume oldest lots first (historical order)
            to_reduce = abs(vs)
            while to_reduce > 0 and lots:
                if lots[0][1] <= to_reduce:
                    to_reduce -= lots[0][1]
                    lots.popleft()
                else:
                    lots[0][1] -= to_reduce
                    to_reduce = 0

    if order == 'lifo':
        lots = deque(reversed(lots))

    if grant_year is not None and grant_type is not None:
        filtered = deque(l for l in lots if l[3] == grant_year and l[4] == grant_type)
        if filtered:
            lots = filtered
        # else: no matching lots — return full pool so gross-up can still proceed

    return lots


def compute_grossup_shares(lots: deque, cash_due: float, price: float, sale_date: date, tax_settings: dict) -> int:
    """
    Compute how many shares to sell so that net_proceeds (after LT/ST cap gains tax) >= cash_due.
    Walks FIFO lots oldest-first. Any shortfall after lots exhausted falls back to ceil(remaining/price).
    Always returns >= ceil(cash_due / price).
    """
    if price <= 0 or cash_due <= 0:
        return 0

    ts = tax_settings
    lt_days = int(ts.get("lt_holding_days", 365))
    lt_rate = (float(ts.get("federal_lt_cg_rate", 0.20))
               + float(ts.get("niit_rate", 0.038))
               + float(ts.get("state_lt_cg_rate", 0.0536)))
    st_rate = (float(ts.get("federal_st_cg_rate", 0.37))
               + float(ts.get("niit_rate", 0.038))
               + float(ts.get("state_st_cg_rate", 0.0765)))

    remaining = cash_due
    total_shares = 0

    for lot in lots:
        if remaining <= 0:
            break
        vest_date, lot_shares, basis = lot[0], lot[1], lot[2]
        hold_days = (sale_date - _to_date(vest_date)).days
        rate = lt_rate if hold_days >= lt_days else st_rate
        # net received per share after paying cap gains tax on the gain portion
        net_per_share = price - rate * max(0.0, price - basis)
        if net_per_share <= 0:
            shares_from_lot = lot_shares
        else:
            shares_from_lot = min(lot_shares, math.ceil(remaining / net_per_share))
        total_shares += shares_from_lot
        remaining -= shares_from_lot * net_per_share

    # Any remaining cash_due covered by unvested / no-basis shares (net = price)
    if remaining > 0:
        total_shares += math.ceil(remaining / price)

    return max(total_shares, math.ceil(cash_due / price))


def compute_sale_tax(timeline_events: list, sale: dict, tax_settings: dict,
                     lot_order: str = 'fifo',
                     grant_year: int | None = None,
                     grant_type: str | None = None) -> dict:
    """
    Compute FIFO cost basis, LT/ST classification, and estimated tax for one sale.

    sale dict keys: date (date), shares (int), price_per_share (float)
    tax_settings dict keys: federal_income_rate, federal_lt_cg_rate, federal_st_cg_rate,
                            niit_rate, state_income_rate, state_lt_cg_rate,
                            state_st_cg_rate, lt_holding_days
    Returns a breakdown dict.
    """
    sale_date = _to_date(sale["date"])
    shares_to_sell = int(sale["shares"])
    price_per_share = float(sale["price_per_share"])
    gross_proceeds = round(shares_to_sell * price_per_share, 2)

    ts = tax_settings
    lt_days = int(ts.get("lt_holding_days", 365))
    fed_income = float(ts.get("federal_income_rate", 0.37))
    fed_lt = float(ts.get("federal_lt_cg_rate", 0.20))
    fed_st = float(ts.get("federal_st_cg_rate", 0.37))
    niit = float(ts.get("niit_rate", 0.038))
    state_income = float(ts.get("state_income_rate", 0.0765))
    state_lt = float(ts.get("state_lt_cg_rate", 0.0536))
    state_st = float(ts.get("state_st_cg_rate", 0.0765))

    lots = build_fifo_lots(timeline_events, sale_date,
                           order=lot_order, grant_year=grant_year, grant_type=grant_type)
    total_available = sum(l[1] for l in lots)

    # Shares sold before vesting (if user is selling more than available vested shares)
    unvested_shares = max(0, shares_to_sell - total_available)
    vested_shares_to_sell = shares_to_sell - unvested_shares

    # Walk FIFO lots for the vested portion
    lots_consumed = []
    remaining = vested_shares_to_sell
    working_lots = deque(lots)
    while remaining > 0 and working_lots:
        lot_date, lot_shares, lot_basis = working_lots[0][0], working_lots[0][1], working_lots[0][2]
        consumed = min(lot_shares, remaining)
        lots_consumed.append({
            "vest_date": lot_date,
            "shares": consumed,
            "basis_price": lot_basis,
        })
        remaining -= consumed
        if consumed < lot_shares:
            working_lots[0][1] -= consumed
        else:
            working_lots.popleft()

    # Classify each consumed lot as LT or ST
    lt_shares = 0
    st_shares = 0
    lt_basis = 0.0
    st_basis = 0.0

    for lot in lots_consumed:
        hold_days = (sale_date - lot["vest_date"]).days
        lot_cost = round(lot["shares"] * lot["basis_price"], 2)
        if hold_days >= lt_days:
            lt_shares += lot["shares"]
            lt_basis += lot_cost
        else:
            st_shares += lot["shares"]
            st_basis += lot_cost

    vested_cost_basis = round(lt_basis + st_basis, 2)

    # Compute gains
    vested_proceeds = round(vested_shares_to_sell * price_per_share, 2)
    lt_gain = round(vested_proceeds * (lt_shares / vested_shares_to_sell) - lt_basis, 2) if vested_shares_to_sell > 0 and lt_shares > 0 else 0.0
    st_gain = round(vested_proceeds * (st_shares / vested_shares_to_sell) - st_basis, 2) if vested_shares_to_sell > 0 and st_shares > 0 else 0.0

    # Unvested portion proceeds and cost (unvested treated as ordinary income, basis = 0)
    unvested_proceeds = round(unvested_shares * price_per_share, 2)

    # Tax computation
    lt_tax = round(lt_gain * (fed_lt + niit + state_lt), 2) if lt_gain > 0 else 0.0
    st_tax = round(st_gain * (fed_st + niit + state_st), 2) if st_gain > 0 else 0.0
    unvested_tax = round(unvested_proceeds * (fed_income + state_income), 2) if unvested_shares > 0 else 0.0

    estimated_tax = round(lt_tax + st_tax + unvested_tax, 2)
    net_gain = round(lt_gain + st_gain, 2)
    total_cost_basis = vested_cost_basis  # unvested has no prior basis
    net_proceeds = round(gross_proceeds - estimated_tax, 2)

    return {
        "gross_proceeds": gross_proceeds,
        "cost_basis": total_cost_basis,
        "net_gain": net_gain,
        "lt_shares": lt_shares,
        "lt_gain": round(lt_gain, 2),
        "lt_rate": round(fed_lt + niit + state_lt, 4),
        "lt_tax": lt_tax,
        "st_shares": st_shares,
        "st_gain": round(st_gain, 2),
        "st_rate": round(fed_st + niit + state_st, 4),
        "st_tax": st_tax,
        "unvested_shares": unvested_shares,
        "unvested_proceeds": unvested_proceeds,
        "unvested_rate": round(fed_income + state_income, 4),
        "unvested_tax": unvested_tax,
        "estimated_tax": estimated_tax,
        "net_proceeds": net_proceeds,
    }
