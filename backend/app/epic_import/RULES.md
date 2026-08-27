# Import rules

Every value this importer derives, and every check it runs, carries an id. The
ids are the vocabulary for reporting an import bug: "rule `G3` reads the cost
basis wrong" is actionable in a way that "the import is wrong" is not. They are
stable — ids are never renumbered or reused, only added.

You will see them in three places:

- the findings list on the import screen, as `[G3] 2024 Purchased: …`
- the legend of the **Import diagnostics** report (admin tools)
- the "What did not reconcile" section of the prompt the app hands you to paste
  into your own assistant

**Only `G0`, `C1` and `C2` block an import**, and only at error severity: those
mean a document was misread, so nothing downstream can be trusted. Everything
else is advisory — Epic's own paperwork sometimes disagrees with itself, and you
decide what to do about it (`BLOCKING_CHECKS` in `draft.py`).

Findings are graded **error** (something is wrong), **warning** (something may be
wrong, or an assumption was made) and **info** (what was done and why).

This file is pinned to the code: a test asserts it documents exactly the ids the
importer can emit, so a new rule without an entry here fails the suite.

---

## Reading the share summary — `G*`

### `G0` — the CSV's own columns
*`share_csv.py`.* Checks the file is Data for Stock Workbook and carries the
columns the rules need. **Error** (blocking) when the file is empty, has no
`Grant` column, has no rows with a share count, or is missing `Shares Granted`
or `Cost Basis of Shares` — a renamed basis column would silently price every
grant at zero, which turns capital gains into ordinary income. **Warning** when
an optional column is absent: `Loan Balance`, `Annual Interest Due`,
`Shares Remaining` or `Shares Sold`. The message lists the columns actually
found, because the usual cause is a rename.

### `G1` — row label → grant year and type
Maps `2024 Purchased` → (2024, Purchase), `2019 Catch-up` → Catch-Up,
`2023 Bonus Shares` → Bonus, `2022 Free` → Free. **Warning** for a category the
mapping has never seen, naming the shares that were therefore not imported. Epic
lists every category for every employee, so rows with no share count are skipped
silently — only a populated row nobody can classify is reported.

### `G2` — Shares Granted → `grant.shares`, and shares nothing accounts for
Straight read. Nothing in either file can check a share count against anything
else, which is why sign-off shows rendered figures rather than a row of ticks.

The same rule reports the shares Epic says have left a grant that `G8` below
cannot explain as a down payment, as **info** per row: the CSV carries no sale
dates or prices, so no sales are invented. Record them on the Sales page, or as
a down payment on the grant they paid for.

### `G3` — Cost Basis ÷ Shares Granted → `grant.price`
The per-share cost basis, with zero-basis detection: a grant taxed as it vests
gets `price = 0`, because what Epic reports for it is accumulated taxed value,
not a price paid. Two conclusive signals — a per-share basis that is not a round
number of cents (a blend of several years' prices), or unvested shares carrying
no unvested value — plus a third for bonus grants whose basis is not that year's
purchase price. Catch-Up grants are always 0. **Info** whenever a basis is
zeroed, saying which signal fired.

### `G7` — 83b Shares → `grant.election_83b`
A non-empty `83b Shares` column sets the flag. Display-only in this app: it
changes how events are rendered, not how they are computed.

### `G8` — cost basis − purchase loan → a down payment paid in stock
Epic reports shares handed back to cover a later purchase's down payment in the
same `Shares Sold` column as shares actually sold, and never says which is
which. The arithmetic does. A grant's down payment is the gap between its cost
basis and its purchase loan, and one paid in stock is a whole number of shares
at that year's price — the policy minimum (a share of the purchase, capped;
both from the content tables) rounded up to the next whole share. When those
down payments add up to exactly the shares Epic reports gone, they are recorded
as `dp_shares` — share exchanges at exercise, which are not taxable disposals.

Only an exact, **unique** match is acted on. **Info** when it reconciles, naming
the grants and share counts. **Warning** when more than one combination would
account for the shares, in which case none are applied. A down payment above the
policy minimum, or a loan paid down since — which widens the same gap — reads as
unexplained shares and falls to `G2` rather than being quietly reclassified.

---

## Reading the loan statement — `L*`

### `L1` — statement row → loan number, balance, rate, due date
*`pdf_statement.py`.* The row grammar, plus the statement's own header date,
account number, per-year subtotals and printed total. **Error** when no loan
rows are found at all — which is how a PDF that is not a Stock Loan Statement
announces itself. **Warning** when a loan number appears twice.

### `L2` — loan name grammar → loan type and loan year
`"<grant>[/<grant>] - Purchase|Interest|Tax Loan[ - <year>]"`. A name too long
for its column wraps onto the next line and is reassembled first. **Warning**
when a name does not parse, quoting it and the shape expected. A purchase loan
carries no year in its name, so the grant year is used.

### `L3` — descriptors + loan type → which grant the loan belongs to
`2018 Grant` → that year's Purchase grant, `2020 Bonus` → Bonus, and so on. Tax
loans on an unqualified `<year> Grant` belong to that year's zero-basis grant —
Catch-Up if there is one, otherwise Bonus — because that is what Epic withholds
against. **Warning** when the grant cannot be told, when the loan points at a
grant the CSV does not have, and once (rather than per row) when no grants could
be read at all.

### `L4` — a loan naming two grants → the bonus side
`"2020 Bonus/2020 Grant - Interest Loan - 2024"` is attributed in full to the
bonus side. **Info** on every such loan, so the attribution is visible rather
than assumed.

### `L5` — in your data but not on the statement
Diagnostics report only, never an import finding. A loan you have that the
statement does not carry: newer than the statement, already paid off, or one
the import failed to produce.

---

## Prices and structure

### `P1` — purchase grant basis → annual share price
A purchase grant's per-share cost basis is that year's share price, dated
1 January to match how the wizard keys prices by year. **Warning** when no
purchase grant carries a basis, because then no prices can be worked out at all.

### `S1` — the company grant schedule → vest_start, periods, exercise_date
*`skeleton.py`.* Vest dates, vesting periods, exercise dates, loan rates, due
dates and the down payment policy are company-wide: they come from the
admin-managed content tables, never from an uploaded file, and an import may not
change them. **Warning** when a template for a year is missing and the nearest
one of the same type is shifted to fit (an admin should add the real one), when
a template has no usable dates, or when no templates are configured at all.
**Error** when a grant has no template and none can be adapted.

---

## Checks — `C*`

Checks run on any draft, whatever produced it: the deterministic parse and a
draft repaired by an assistant go through exactly the same ones. A check that
only works on our own output is not a check.

### `C1` — the statement against its own subtotals
For each due year, the loans due that year must add up to the subtotal printed
on the statement. **Error, blocking**: a mismatch means rows were misread.

### `C2` — the statement against its own total
All loans must add up to the printed total. **Error, blocking**. **Warning**
(not blocking) when neither subtotals nor a total could be read, because then
there is nothing to check against.

### `C3` — loans against the CSV's loan balance
For each grant, the loans attributed to it must reproduce that grant's
`Loan Balance` in the CSV. **Error** — the two files disagreeing, which is
yours to override.

### `C4` — loans against the CSV's annual interest
For each grant, Σ(loan amount × rate) must equal `Annual Interest Due`.
**Error**. This is what catches a loan attributed to the wrong grant when the
balances happen to add up anyway.

### `C5` — unvested value against vested share counts
At each vesting checkpoint, (shares remaining − vested) × per-share basis must
equal the reported unvested value. **Warning**, reported once per grant.

### `C6` — Shares Remaining against Granted − Sold
**Warning** when the CSV's own three columns do not agree.

### `C7` — due dates against the CSV's Loan Due Year
**Warning** when the draft's loans are not all due in the year the CSV says.

### `C8` — share counts against the CSV
**Error** when a grant's shares differ from `Shares Granted`, or when the CSV
lists a grant the draft does not have.

### `C9` — loan rates against the rates on record
**Warning** when an interest or tax loan's rate differs from the content
tables. Purchase loans are exempt: they get refinanced, so the rate on record
is the original one and no longer matches the current balance.

### `C10` — the vesting schedule against the company schedule
**Warning** when a draft's `vest_start`, `periods` or `exercise_date` differs
from the template — including when a repaired draft tries to change them, which
is reported and then ignored in favour of the schedule.

### `C11` — down-payment shares against the loan they paid
**Warning** when a grant's `dp_shares` do not come to the gap between its cost
basis and its purchase loan, and when the draft hands back more shares in total
than the CSV reports gone from all grants. The check-back for `G8`, and it
applies just as much to a figure a repaired draft supplied.

---

## The repair loop — `R1`

### `R1` — reading a draft handed back after repair
*`draft_from_payload`.* Tolerant about shape, strict about types. **Error** for
JSON that is not an object, has no `grants` array, or carries a grant or loan
whose fields cannot be read; **warning** for a price row that has to be skipped.
Structural fields are never taken from a payload — an attempt to change them is
reported as `C10` and the company schedule is used regardless.

Parse complaints from an earlier round are demoted to **info** once a corrected
draft supersedes them, prefixed "(before your correction)". Otherwise a repair
that fixed everything would still read as failing, and the loop could never end.
