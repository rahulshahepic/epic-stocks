# Privacy Policy

**Last updated:** 2026-04-12

Equity Vesting Tracker ("Epic Stocks") is open-source software that you or your organization self-host. This policy explains what data the application collects, how it's stored, and who can access it.

## We Will Never Sell Your Data

**Your data is never sold.** We do not sell, rent, or trade your personal or financial data to any third party for any purpose, commercial or otherwise. This commitment applies to all data you enter — account information, equity grants, loans, prices, and everything else.

## What We Collect

### Account Information (from your identity provider)

When you sign in via your identity provider (Google, Azure Entra ID, or any OIDC-compliant provider configured by your admin), the application receives and stores:

- **Email address** — used as your unique identifier
- **Display name** — shown in the UI
- **Profile picture URL** — shown in the UI (if provided by your identity provider)
- **Subject ID** — a stable identifier used to link your identity provider account

We do **not** receive or store your password, contacts, calendar, or any other data from your identity provider.

### Financial Data (entered by you)

You manually enter the following data, which is stored in the application database:

- **Equity grants** — year, type, share count, exercise price, vesting schedule
- **Stock loans** — loan type, amount, interest rate, due date
- **Share prices** — effective date and price per share

### Computed Data (never stored)

The application computes an event timeline (vesting events, income, capital gains) from your grants, loans, and prices on every request. **Computed events are never written to the database.** They exist only in memory during your request.

### What We Don't Collect

- Passwords (authentication is handled entirely by your identity provider via OIDC)
- Analytics or usage tracking
- Cookies beyond the authentication session token
- Data from other users
- Any data from your identity provider beyond the profile fields listed above

## How Your Data Is Isolated

- Every database query filters by your authenticated user ID
- You can only read, modify, or delete your own data through the standard API
- The source code is open for you to verify this: every router in `backend/app/routers/` and `backend/scaffold/routers/` filters by `user_id`
- **The one exception is the sharing feature** described below: if you choose to invite someone, they can view (but never modify) your financial data through dedicated read-only endpoints

## Who Can Access Your Data

### You

You have full access to your own data through the application UI and API. You can:

- View, create, update, and delete all your grants, loans, and prices
- Export all your data to Excel at any time
- **Reset your data** — delete all grants, loans, and prices while keeping your account (Settings > Danger Zone > Reset All Data)
- **Delete your account** — permanently remove your account and all associated data, including grants, loans, prices, notification preferences, and push subscriptions (Settings > Danger Zone > Delete Account)

Both actions are self-service, immediate, and irreversible. No admin involvement is required.

### The Site Operator

The person or organization running this server has **technical access** to the server environment. Your financial data is encrypted per-user with AES-256-GCM before being written to the database (the master key is generated automatically on the server on first deploy). However, the operator holds the master key and could decrypt the data if they chose to.

**If you are uncomfortable with this, you have options:**

1. **Self-host** — Run your own instance. You control the database and the master key.
2. **Review the code** — The application is open-source. Verify exactly what's stored and how.
3. **Don't enter sensitive data** — Use the tool only for data you're comfortable sharing with the operator.

### Other Users

Other users of the same instance **cannot** access your data unless you explicitly invite them. The API enforces strict per-user data isolation.

### People You Invite (Sharing Feature)

You can invite others by email to view your financial data in read-only form. **This is entirely optional** — no one can see your data unless you explicitly send them an invitation. Before sharing, understand what this means:

**What viewers can see:**
- Your Dashboard summary (share price, vested shares, income, capital gains, loan balances, tax estimates)
- Your full Events timeline
- Your Grants, Loans, Prices, and Sales — all the underlying data, in read-only form

**What viewers cannot do:**
- Modify, create, or delete any of your data
- See optimization Tips
- Use What If scenarios (exit date projections, investment interest deduction toggle)
- Change your settings or preferences

**You are sharing real financial data.** Share prices, grant details, loan balances, interest rates, and tax information will be visible to anyone you invite. Only invite people you trust with this information.

**Understanding the risk:** Once someone accepts your invitation, they can view your data whenever they want until you or they revoke access. You can see the last time they viewed your data (shown in Settings), but you **cannot control what they do with the information they see** — they could screenshot it, write it down, or share it with others. Treat this like handing someone a copy of your financial statement. Revoking access removes their ability to fetch new data from the server, but does not erase anything they may have already seen or saved.

**How invitations work:**
- You enter an email address in Settings → Sharing → Invite
- The system sends an email with a clickable link and a manual-entry code
- The recipient can sign in with any configured provider (Google, Microsoft, etc.) — it does not need to match the email the invitation was sent to
- Invitation links expire after 7 days if unused; you can resend to extend
- Once accepted, the invitation token is permanently bound to the accepting user — no one else can use it
- Both you (the inviter) and the viewer can revoke access at any time

**Per-viewer notifications:** Viewers can optionally receive event notifications about your data. They control this with a per-inviter toggle — you cannot force notifications on a viewer, and they cannot access notification content beyond the same event-count summary that your own notifications contain (no financial amounts are included).

**Invitation emails:** Invitation emails are sent via the configured email provider (Resend or SMTP). They contain only the inviter's display name, a one-time token/code, and a link. No financial data is included in the email.

### Third Parties

The site operator uses the following third-party infrastructure. Your data may pass through or be processed by these services:

- **Your OIDC identity provider** (e.g. Google, Azure Entra ID) — to verify your identity during sign-in. Your provider receives your credentials; the application only receives your profile fields (email, name, profile picture, subject ID).
- **Hetzner** — the VPS hosting provider. The application and database run on Hetzner hardware. Hetzner has physical and administrative access to the server environment.
- **Cloudflare** — used for DDoS protection and DNS. HTTPS traffic passes through Cloudflare's network, which means Cloudflare can observe (but does not decrypt, under standard configuration) the metadata of your requests.
- **Porkbun** — domain registrar. Porkbun manages the domain name; they have no access to your application data.
- **Resend** — used to deliver email notifications and invitation emails (if configured). Resend receives the recipient address and email content. Email notifications contain **no financial data** — only a summary count of events (e.g., "you have 2 events today") and a link to log in. Invitation emails contain only the inviter's display name, a one-time code, and a link — no financial data. No share counts, prices, or loan amounts are included in any email.
- **Push notifications** (if enabled) — delivered via the Web Push protocol through your browser vendor's push service (e.g., Google FCM for Chrome). Notification content contains no financial data — only an event count summary.

None of these services receive your financial data for their own purposes, and your data is never sold to any of them or to any other third party.

## Data Retention

- Your data persists until you explicitly delete it or delete your account
- **Resetting your data** (Settings > Danger Zone) removes all grants, loans, and prices but keeps your account active
- **Deleting your account** (Settings > Danger Zone) permanently removes your user record and all associated data: grants, loans, prices, push subscriptions, and email preferences
- Both actions take effect immediately and cannot be undone
- There are no backups unless the site operator configures them independently

## Data Portability

You can export all your data at any time using the Excel export feature. The export includes your grants, loans, prices, and computed event timeline.

## For Self-Hosters / Site Operators

If you run an instance of this application for others, you should:

1. **Secure the database** — restrict access to your PostgreSQL instance (or SQLite file in development). Use strong credentials and network-level isolation.
2. **Use HTTPS** — the included Caddy configuration handles this automatically
3. **Keep the JWT_SECRET secret** — if compromised, attackers can forge authentication tokens
4. **Set `KEY_ENCRYPTION_KEY`** — enables per-user AES-256-GCM column-level encryption of financial data at rest. Auto-generated on production deploy.
5. **Communicate your own policies** — let your users know who has server access and how you handle backups

## Understanding the Risks

Before entering your financial data, you should understand what protects you, what doesn't, and where residual risk remains.

### What protects you

**TLS (HTTPS) protects data in transit.** When you interact with this application over HTTPS, your data is encrypted between your browser and the server. An attacker monitoring your network cannot read your share counts, loan amounts, or prices as they travel over the wire. The included Caddy configuration provisions TLS certificates automatically. This is a well-understood, broadly trusted protection — but it only covers the network path. Once your data arrives at the server, TLS has done its job.

**Open source protects through transparency.** The full source code for this application is published on GitHub. You can read exactly what data is collected, how it's stored, how queries are scoped to your user ID, and how encryption works. You can build the application from source yourself to verify that the binary matches the code. Open source does not prevent bad behavior, but it makes bad behavior discoverable. Anyone — you, a security researcher, a journalist — can audit the code at any time.

**This privacy policy protects through disclosure and accountability.** A written privacy policy creates a record of what the operator has committed to. If the operator violates their own policy, that violation has legal consequences in most jurisdictions. Consumer protection laws, contract law, and in some cases data protection regulations (GDPR, CCPA) give you recourse if your data is handled contrary to the stated policy.

### What does not fully protect you

**You are trusting the back end.** This is the most important risk to understand. The code on GitHub and the code running on the server you are connecting to are not provably the same thing. The operator could have deployed a modified version of the application that logs your data, disables encryption, forwards your financial information to a third party, or behaves differently from what the source code describes. You have no way to independently verify what software is running on a server you do not control. This is not unique to this application — it is true of every web service you use.

### Possible mitigations for backend trust

Several mechanisms exist to partially mitigate this risk, though none eliminate it completely:

- **Third-party security audits.** An independent security firm can review the deployed infrastructure, verify that the running code matches the published source, and test for vulnerabilities. A clean audit report provides some assurance — but it is a snapshot in time. The operator could change the deployment after the audit.

- **Compliance certifications (SOC 2, HITRUST, ISO 27001).** These frameworks require the operator to implement and document security controls, submit to periodic audits, and maintain evidence of compliance. A SOC 2 Type II report, for example, covers a sustained period (typically 6-12 months) and is reviewed by a licensed CPA firm. HITRUST and ISO 27001 have similar structures. These certifications significantly raise the bar for bad actors because they require ongoing evidence, not just a one-time check. However, auditor liability statements almost universally include carveouts for **intentional misrepresentation** by the operator. If the operator deliberately deceives the auditor — for example, by deploying different code during the audit window — the certification may not catch it, and the auditor disclaims responsibility for the deception. Certifications reduce risk; they do not eliminate it.

- **Reproducible builds and deployment attestation.** Emerging technologies like reproducible builds, signed container images, and deployment transparency logs could eventually allow users to cryptographically verify that a server is running a specific version of published source code. These techniques are not yet mainstream for typical web applications, but they represent the direction the industry is moving.

### Privacy policies and law enforcement

Most technology companies — from the largest platforms to small SaaS providers — include language in their privacy policies permitting disclosure of user data to comply with legal process. This typically means the operator may share your data in response to:

- Subpoenas (which in many jurisdictions do not require a judge's approval)
- Court orders
- Administrative searches or regulatory requests
- National security letters (in the United States)

These provisions are often broadly worded, giving the operator discretion to decide whether a request is valid and whether to notify you. Some policies include language like "at our sole discretion" or "as we believe in good faith is necessary." **This application's privacy policy does not include such a carveout**, but any operator running an instance for others operates within their own legal jurisdiction and may be compelled to comply with legal process regardless of what any privacy policy says.

If you self-host, you control how you respond to legal requests. If someone else hosts it, they do.

### The bottom line

You should enter financial data into this application — or any application — only if you are comfortable with the trust model. For this application, that means:

1. You trust the network path (TLS handles this).
2. You trust that the operator is running the published code (open source helps, but cannot prove this).
3. You trust the operator not to access your data outside the application (encryption raises the bar, but the operator holds the master key).
4. You accept that no certification, audit, or policy can fully protect against a determined bad actor with server access.
5. If you use the sharing feature, you trust the people you invite not to misuse what they see. Revoking access stops future data loads but cannot unsee what was already viewed.

The safest option is always to **self-host** and control the entire stack yourself.

## Changes to This Policy

This policy may be updated as the application evolves. Changes will be reflected in the `PRIVACY.md` file in the repository with an updated date.

## Contact

This is an open-source project. For privacy questions or concerns, open an issue on the GitHub repository.
