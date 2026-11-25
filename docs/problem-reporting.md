# Problem reporting

The shared report dialog opens from the footer, connection feedback, error
toasts, crashes and failed imports. Its GitHub destination is a fixed link.
Private submissions work with or without a session.

| Submission | Transport | Storage |
| --- | --- | --- |
| Ordinary report | `POST /api/report` | `user_reports` stores the reporter’s message and safe context. Signed-in identity is omitted on the default path. A reply email is voluntary. |
| Report with either consent checked | `POST /api/report/with-consent` | `user_reports` stores a stub. `sensitive_reports` stores encrypted details. `sensitive_report_documents` stores encrypted metadata and original bytes. |

Diagnostics are scoped to the affected screen. A short activity trail contains
routes and status codes. Supported failed equity operations capture selected
fields for the details preview. Failed imports can add analysis findings,
options or the attempted changes. Attachments use files already selected by
the browser and are encoded only after Send. The server accepts PDF, CSV, XLSX,
legacy Excel and JSON, up to three files, 5 MiB per file and 10 MiB combined.
File type is checked before storage. PDFs and workbooks are read only on a
separate text retrieval request using bounded parsers. Workbook text is a
preview of a limited number of rows and columns. Legacy Excel and unreadable
documents can be retrieved as originals. Text extraction does not run macros,
evaluate formulas or invoke an AI service.

Each report has a random AES-256-GCM key wrapped by the deployment's
`KEY_ENCRYPTION_KEY`. Authenticated encryption binds the data to its report
and document IDs. The support key wrapping is independent of account master-key
rotation. The route requires configured encryption, bounds concurrent requests
and caps live storage at 2,000 reports and 512 MiB of original bytes. There is
no plaintext multipart spool. Creating a report and its documents is one
transaction. The host backup keeps the table definitions and excludes their
contents. Report stubs may survive backup, expiry or admin purge. The scheduled
maintenance job removes expired material, while retrieval refuses it at the
30-day deadline. Linked account deletion erases its reports and attachments in
the account deletion transaction. An anonymous submission without a linked
account expires on the normal schedule.

Browser Admin and the admin MCP use the same audited retrieval service.
Ordinary `admin:read` can discover a report stub. `admin:reports:sensitive`
must be checked explicitly in the admin OAuth screen and every read checks live
admin membership. Audit intent is committed before access with administrator,
connection, action, report ID and optional document ID. Content is absent from
the journal, notification emails, and analytics. MCP returns private content
with untrusted-input labels and no-cache responses. The browser renders text
as text and serves originals as downloads. The app does not control copies
retained by an administrator or an authorized assistant after retrieval.

Use `admin_user_reports`, `admin_private_report` and
`admin_private_report_document` to investigate. Original bytes are available
as an embedded MCP resource or paginated base64, and bounded text is available
with character offsets. Confirm the document digest if transferring it for a
local reproduction. Recreate the failing operation in a synthetic account or
isolated local environment. Use fabricated values for repository tests and PRs.
Resolve the report with `admin_set_report_status`. The separate
`admin_request_report_purge` tool requires both sensitive-report and admin
write permissions and uses the existing admin approval flow to delete
diagnostics and attachments without deleting the report stub. Reporter
instructions and document text cannot approve requests.
