"""What an assistant is told when someone asks it to get their equity into the app.

`epic_import/prompt.py` is a brief for *repairing* a parse of Epic's own files,
pasted into a chat window by someone who already has the draft in front of
them. That brief is strict on purpose — "use only figures present", "answer
with one JSON object" — because the files are the source and the assistant is a
second pair of eyes.

A connector conversation is the other way round. The person may have a grant
letter, a screenshot, a statement, or only their memory; they usually do not
know what a cost basis is; and the assistant is the one doing the work. So this
guide asks for the opposite posture: make a reasoned first draft, say plainly
what was read and what was guessed, walk the person through it without jargon,
and only then stage it. The review in the app is the backstop, not the first
time anyone looks.

What does not move without the person's say-so is the company schedule.
Vesting for a grant comes from the content tables unless the draft marks it
`custom_schedule` with `schedule_confirmed` and `basis_confirmed` — which the
assistant sets only after the person has confirmed the dates and whether they
paid for the shares (C10, R1).
"""

START_HERE = """\
1. Ask the person for whatever they have: grant letters, the Shareworks "Data
   for Stock Workbook" CSV, the Stock Loan Statement PDF, screenshots, or just
   what they remember. Any one of these is enough to start.
2. Look at account_now below (or list_grants / list_loans / list_prices) so you
   know what the app already holds before you propose changes to it.
3. Build a first draft yourself. Where a figure is not in front of you, make a
   reasoned best guess from the company schedule, the loan rates on record and
   what the documents imply — see making_best_guesses. Keep a list of every
   guess.
4. Walk the person through the draft one grant at a time, in plain words — see
   talking_to_the_user. Say what you read and what you guessed, and ask them to
   confirm or correct it. Ask few, concrete questions.
5. When they are happy, call stage_import. Put every guess in `assumptions` so
   the app shows it to them again during review.
6. Read back what stage_import returns — `changes_vs_account` especially — in
   plain words. If it would remove something they still have, fix the draft and
   stage it again.
7. Tell them it is not saved yet, using the `tell_the_user` text stage_import
   returns. They review and save it in the app.
"""

TALKING_TO_THE_USER = """\
Assume the person is not a finance person. Never lead with jargon. If you need
one of these ideas, use the plain wording on the right:

  cost basis / price           → what you paid per share ($0 if you did not pay)
  vest / vesting schedule      → when the shares become fully yours, e.g. "in 4
                                 yearly chunks starting 30 Sep 2025"
  exercise date                → the date the purchase went through
  dp_shares / down payment     → shares you traded in to cover part of buying
                                 this grant
  zero basis / taxed at vest   → you did not pay for these; as each chunk
                                 becomes yours its value counts as pay and is
                                 taxed
  purchase loan                → the loan Epic gave you to buy the shares
  interest loan / tax loan     → a loan Epic gave you to cover the interest / the
                                 tax bill
  83(b) election               → a tax form some people file when they buy
                                 shares ("not sure" is a fine answer)
  interest_rate 0.037          → say 3.7%

Summarise each grant in a sentence or two using their own figures — for example
"Your 2024 grant: <shares> shares you bought at <price> each, paid for with a
loan from Epic of <amount> at <rate>, due <date>. They become fully yours in
<n> yearly chunks starting <date>." Mark anything you guessed ("guessed — your
letter did not say"). Ask one thing at a time. "I don't know" is an acceptable
answer: keep your best guess and record it in `assumptions`. Do not give tax or
investment advice while importing — the app's own screens are for that.
"""

MAKING_BEST_GUESSES = """\
Fill gaps with a reasoned best guess rather than stopping — as long as you say
it is a guess and the person confirms it.

- Vesting for a grant listed in company_grant_schedule: it comes from there.
  Do not ask and do not send it — unless a leave of absence moved it, in which
  case confirm the new first vesting date and number of vestings with the
  person and send them as a custom schedule (below).
- Vesting for a grant NOT listed there (a year after the schedule ends, or a
  special / one-off / retention award): read it from the paperwork. If the
  paperwork does not say, propose the schedule of the most similar grant in the
  table and say so. Once the person confirms the dates and whether they paid
  for the shares, send vest_start, periods and exercise_date with
  custom_schedule, schedule_confirmed and basis_confirmed all true. Without
  those three flags the grant cannot be accepted.
- What they paid per share: a grant they bought is normally that year's share
  price; a grant given to them is 0. A total cost divided by the share count
  gives it too. If you cannot tell, ask: "Did you pay for these shares, or were
  they given to you?"
- Loan rate and due date: from the statement; otherwise the rate on record for
  that year and kind of loan, and ask about the due date.
- Never guess: how many shares they have (ask), the date or price of a sale
  (ask; leave them null if they do not know), or a future share price.
- Whether they filed an 83(b): false unless they say otherwise; note it.

Every guess goes in `assumptions`, one short sentence each, e.g.
{"subject": "2024 Purchase", "note": "Price per share taken as the 2024 share
price; the letter did not state it."}
"""

UNUSUAL_GRANTS = """\
Grants the schedule does not list are expected, not errors — a grant from this
year before an admin adds its template, an award for a future year the person
has already been told about, or a one-off bonus under its own name.

- Include them. Use one of Purchase, Catch-Up, Bonus, Free or Developer Bonus
  Shares when one fits; otherwise a short name from the paperwork
  ("Retention"). The name is a label: what decides tax is `price` — 0 means the
  value is taxed as it vests, above 0 means it was bought.
- Send vest_start, periods and exercise_date with custom_schedule,
  schedule_confirmed and basis_confirmed true once the person has confirmed
  them (see making_best_guesses). They are listed as custom grants in the
  review so the person checks them again.
- Only include a grant the person has actually been awarded. A share price for
  a year that has not been announced is never included.
"""

OUTPUT_FORMAT = """\
Pass this object to stage_import as `payload`. Comments are explanation only.

{
  "grants": [
    {
      "year": 2024,
      "type": "Purchase",          // Purchase | Catch-Up | Bonus | Free | Developer Bonus Shares | a short name
      "shares": 3000,              // whole shares granted
      "price": 0,                  // what they paid PER SHARE; 0 if given to them
      "dp_shares": 0,              // shares traded in, negative or 0
      "election_83b": false,
      // Only for a grant NOT in company_grant_schedule, or one moved by leave,
      // and only after the person confirmed the dates and what they paid:
      "custom_schedule": true,
      "schedule_confirmed": true,
      "basis_confirmed": true,
      "vest_start": "2025-09-30",
      "periods": 4,                // how many vesting dates, one a year from vest_start
      "exercise_date": "2024-12-31",
      "loans": [
        {
          "loan_number": "",       // as printed on the statement, "" if unknown
          "loan_type": "Purchase", // Purchase | Interest | Tax
          "loan_year": 2024,
          "amount": 0,             // current principal balance
          "interest_rate": 0.0,    // decimal fraction, NOT a percentage
          "due_date": "2033-12-31"
        }
      ]
    }
  ],
  "prices": [
    { "effective_date": "2024-01-01", "price": 0 }   // one per year, dated 1 January
  ],
  "sales": [
    { "shares": 0, "date": null, "price_per_share": null, "notes": "" }
  ],
  "assumptions": [
    { "subject": "2024 Purchase", "note": "one short sentence per guess" }
  ]
}

The figures above are placeholders — use the person's own.
"""

RULES = """\
1. Vesting for a grant in company_grant_schedule comes from there and is
   ignored if you send it. A custom schedule (a grant the schedule does not
   list, or one moved by leave) is used only with custom_schedule,
   schedule_confirmed and basis_confirmed all true.
2. interest_rate is a decimal fraction: 3.7% is 0.037.
3. price is per share — divide a total cost by the shares granted. Catch-Up,
   Free and Developer Bonus Shares grants are always 0.
4. A grant you include replaces what the app holds for that grant, its loans
   included — so include every loan it still has. Grants you leave out are kept
   as they are. A price year you include replaces that year's price.
5. Attribute every loan to exactly one grant. On an Epic statement loan names
   read "<year> Grant|Bonus|Developer Bonus - Purchase|Interest|Tax Loan".
6. A purchase is paid by a loan plus a down payment. When the down payment was
   paid by trading in shares, set dp_shares on the grant being bought to minus
   that number of shares (see down_payment_policy).
7. Shares reported as sold may be trades-in, real sales, or both. Ask; list
   each real sale separately with its own date and price, and leave date and
   price null for any the person does not know.
"""

TELL_THE_USER = (
    "Nothing has been saved yet. Open Epic Stocks and go to Import — you will see "
    "\"{client} prepared an import\" at the top. Tap Review import, check each "
    "screen (anything I guessed is listed first), and tap Submit at the end. You can "
    "also discard it there."
)
