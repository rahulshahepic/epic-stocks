# Secure reviewer setup

**Do this only after the reviewer implementation is deployed and its staging
acceptance workflow has passed. No production credentials were provisioned by
this assignment.** Do not use the development `/api/auth/test-login` endpoint on
any deployed environment. The app refuses that switch in production.

1. Sign in as the existing administrator. Open **Admin → Directory reviewer
   accounts**. Choose **OpenAI**, **established**, and an access period long
   enough for review (up to 90 days). Select **Provision reviewer**.
2. Copy the generated login and password into your password manager. Hide the
   credential. It cannot be retrieved later; rotate if lost.
3. Repeat for **Anthropic**. The two accounts must have different logins and
   independent financial records. Provision more accounts per platform when
   independent automated test runs need concurrent mutable state. Do not share
   a single dataset between platforms. Each account supports up to the existing
   connection quota and persistent writes; separate accounts give independence.
4. Optionally provision separate **empty** accounts for onboarding/import tests.
   Established accounts already contain grants, loans, invented prices,
   compensation, retirement parameters and conditional expense plans.
5. Start the platform's OAuth connection to `https://epic-stocks.com/mcp`.
   On the Epic Stocks login page choose **Directory reviewer sign-in**, or
   visit `https://epic-stocks.com/reviewer-login` in the same browser first.
   Enter the credentials, then approve the selected ordinary account scopes.
   No Google account, email, SMS, MFA or fixture provisioning is required.
6. Ask “Verify my active account.” Expect `get_account_context` to say
   `synthetic: true`, `initialized: true`, the intended platform/scenario and a
   **FICTIONAL** notice. Stop immediately if it does not.
7. Test reads, one confirmed financial edit, retirement analysis and widgets.
   Reconnect after credential rotation/extension; old browser and OAuth tokens
   are deliberately invalidated. Reset only at a coordinated review boundary.
8. Supply OpenAI credentials only in private **Review details**. For Anthropic,
   follow its current instructions: do not enter credentials into the portal;
   supply the dedicated account securely when the reviewer requests access.
9. Revoke access when the review cycle ends. Expiration/revocation preserve
   fictional test state; delete accounts explicitly when no longer needed.

Admin-connected assistant example:

> Provision an OpenAI reviewer with the established fictional employee scenario
> for 60 days. Show the generated credential once and file the access request.

The assistant calls `admin_request_reviewer_access`; access waits for your
existing browser approval or one-time code delivered to your own push devices.
The password is generated before approval and becomes usable only after it.
Approve the request showing platform, scenario, account and duration. If the
password is lost, request rotation rather than retrieving it from history.

Management prompts:

- “List reviewer accounts and expiration dates.” → `admin_list_reviewers`.
- “Rotate and extend reviewer #ID for 60 days.” → approved access request with
  matching platform/scenario and `reviewer_id`.
- “Preview a reset of reviewer #ID.” → `admin_reset_reviewer`; explicitly confirm
  the bound preview before applying. It affects that account only.
- “Revoke reviewer #ID and invalidate its connections.” → preview/confirm revoke.
- “Delete reviewer #ID.” → preview/confirm deletion.
- “Show recent connector activity for this reviewer.” → existing admin
  connection/audit tools; inspect names/outcomes, never financial values.

Do not put passwords, raw tokens, verifier strings or private account data in
issues, PR descriptions, assets, logs or archives. Do not give reviewers an
administrator account. Reviewer accounts cannot receive admin/content privileges.
