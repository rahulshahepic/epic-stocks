# Privacy Policy

**Last updated:** 2026-03-20

Equity Vesting Tracker ("Epic Stocks") is open-source software that you or your organization self-host. This policy explains what data the application collects, how it's stored, and who can access it.

## What We Collect

### Account Information (from Google Sign-In)

When you sign in with Google, the application receives and stores:

- **Email address** — used as your unique identifier
- **Display name** — shown in the UI
- **Profile picture URL** — shown in the UI
- **Google subject ID** — a stable identifier used to link your Google account

We do **not** receive or store your Google password, contacts, calendar, or any other Google data.

### Financial Data (entered by you)

You manually enter the following data, which is stored in the application database:

- **Equity grants** — year, type, share count, exercise price, vesting schedule
- **Stock loans** — loan type, amount, interest rate, due date
- **Share prices** — effective date and price per share

### Computed Data (never stored)

The application computes an event timeline (vesting events, income, capital gains) from your grants, loans, and prices on every request. **Computed events are never written to the database.** They exist only in memory during your request.

### What We Don't Collect

- Passwords (authentication is handled entirely by Google)
- Analytics or usage tracking
- Cookies beyond the authentication session token
- Data from other users
- Any data from your Google account beyond the profile fields listed above

## How Your Data Is Isolated

- Every database query filters by your authenticated user ID
- You can only read, modify, or delete your own data through the API
- There are no API endpoints that expose one user's data to another user
- The source code is open for you to verify this: every router in `backend/routers/` filters by `user_id`

## Who Can Access Your Data

### You

You have full access to your own data through the application UI and API. You can:

- View, create, update, and delete all your grants, loans, and prices
- Export all your data to Excel at any time
- Delete your account, which permanently removes all your data

### The Site Operator

The person or organization running this server has **technical access** to the database file. This means they could, in principle, read your stored data by opening the database directly. The application does not currently encrypt financial data at rest.

**If you are uncomfortable with this, you have options:**

1. **Self-host** — Run your own instance. You control the database.
2. **Review the code** — The application is open-source. Verify exactly what's stored and how.
3. **Don't enter sensitive data** — Use the tool only for data you're comfortable sharing with the operator.

### Other Users

Other users of the same instance **cannot** access your data. The API enforces strict per-user data isolation.

### Third Parties

The application does not send your data to any third-party services. The only external communication is:

- **Google OAuth** — to verify your identity during sign-in
- **Push notifications** (if enabled) — sent via Web Push protocol; notification content is generated server-side

## Data Retention

- Your data persists until you explicitly delete it or delete your account
- Deleting your account removes all your grants, loans, prices, and profile information permanently
- There are no backups unless the site operator configures them independently

## Data Portability

You can export all your data at any time using the Excel export feature. The export includes your grants, loans, prices, and computed event timeline.

## For Self-Hosters / Site Operators

If you run an instance of this application for others, you should:

1. **Secure the database file** — restrict filesystem access to the SQLite database
2. **Use HTTPS** — the included Caddy configuration handles this automatically
3. **Keep the JWT_SECRET secret** — if compromised, attackers can forge authentication tokens
4. **Communicate your own policies** — let your users know who has server access and how you handle backups
5. **Consider database encryption** — use full-disk encryption or SQLite encryption extensions for additional protection

## Changes to This Policy

This policy may be updated as the application evolves. Changes will be reflected in the `PRIVACY.md` file in the repository with an updated date.

## Contact

This is an open-source project. For privacy questions or concerns, open an issue on the GitHub repository.
