# First-use pilot and launch acceptance

Refs #667. Rahul recruits 10–15 volunteers across short/long tenure, iPhone/Android/desktop and different comfort with finance. Participation is voluntary. No invitations have been sent and no participants have been observed by this work.

## Materials and privacy

Use the repository's synthetic stock-workbook and loan-statement fixtures, including partial, stale and malformed variants. Real records are optional only if the participant and company rules permit their use; observers do not collect or retain them. Never record balances, filenames, document text, account identifiers, screenshots of real financial data or credentials. Do not use the participant's identity as an analytics key. A pilot session code is only for the observer's de-identified notes and must not be entered into the product.

## Script — give the URL, then stay quiet

1. “See whether this can explain your stock position. Start where you would normally start.” Start timing when import begins. Observe whether they can find the right Eureka documents without coaching; the internal navigation path still needs a verified, redacted reference from an authorized employee.
2. “Check whether the preview agrees with the paperwork.” Ask them to say what is known, missing, estimated or stale. Do not count rendering a dashboard as accuracy. For synthetic records, compare grants/share counts, live loan principal and the statement cutoff against the fixture's source evidence. Require the participant to notice unavailable accrued-interest evidence and not infer zero debt from a missing statement.
3. “Keep this so you can use it again.” Observe signup carryover without another upload, the first useful saved result, duplicate-import behavior and recovery from a wrong file. Use only synthetic accounts for automated walkthroughs.
4. “Find the next vesting or payoff. Decide whether you want a reminder.” Observe comprehension and voluntary opt-in/decline. Do not enable notifications for them.
5. “Try changing a retirement date. Tell us what changed and what assumptions stayed.” Check understanding of the exit estimate, manual overrides and pre-retirement costs.
6. Ask them to return once later and find the same result. Record a return observation separately; a signup alone is not retention.

After an uncoached attempt ends, ask what was confusing. Any coaching ends that uncoached attempt; record the outcome rather than restarting the timer to make the result look better.

## Scorecard

| Field | Allowed observation |
|---|---|
| Session / device / tenure | Nonidentifying session code, mobile/desktop category, broad tenure band |
| Import start → accurate position | Elapsed seconds; source evidence reviewed; accurate / inaccurate / cannot verify |
| Discovery / trial / reconciliation / signup | Completed / abandoned / blocked and a fixed error category |
| Repeat import / recovery | Preserved manual schedule, no duplicate rows, removal explicitly understood, could recover |
| Reminder | Understood; opted in / declined / unavailable; no notification contents |
| Return | Returned / did not return / not observed, with time window |
| Defect | Reproduction with synthetic fixtures, severity, issue/PR link; no financial payload |

Denominator: all eligible uncoached import starts, including abandonment and blocked attempts. Count each participant's first attempt once; report retries separately. “Accurate within five minutes” means independently reconciled evidence within 300 seconds, not no visible error. An unavailable source balance cannot count as verified accurate. Report counts as well as proportions; 10–15 people do not establish a precise population rate.

## Acceptance and release decision

The proposed **85% within five minutes** is a hypothesis, not a measured result. Predeclare how partial evidence is scored. For 10 participants, 9 successes meets the proposed threshold; for 15, 13 does. An inaccurate result accepted as correct, data loss, privacy leak or lost signup carryover is a launch blocker regardless of the aggregate rate. Fix blockers in reviewed PRs, rerun the affected automated flow, then retest with a fresh uncoached participant. Freeze unrelated features during the candidate pilot.

Automated mobile/desktop/light/dark/accessibility walkthroughs supplement this pilot; they do not replace volunteers. Record the final sample counts, unresolved issues and the operator's checklist decision before broad advertisement. Current result: **not run; recruitment and real observations remain human-owned**.
