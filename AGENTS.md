# Agent instructions

Read [CLAUDE.md](CLAUDE.md) in full before changing this repository. Every rule
in that file applies to Codex and other coding agents, including the mandatory
test, documentation, accessibility, mobile-first, and screenshot workflows.

Read and follow [REVIEW_POLICY.md](REVIEW_POLICY.md) before opening, reviewing,
approving or merging a pull request. It applies to all contributors and agents.

- Work on a feature branch and open a PR to `staging`; promote to `main` only
  from `staging`. Keep all required CI checks passing.
- Have ChatGPT/Codex or Claude review the current head in a separate review
  session. Prefer the other assistant when one wrote the implementation.
- Request that review by adding the `Needs Review` label after your final push
  for each batch (on opening the PR and after each round of fixes). Pushes
  alone do not start it. Leave `Under Review`, `Waiting for Changes` and
  `Ready to merge` to the review session.
- Finish authorized implementation tasks by merging the feature PR into
  `staging` once current-head independent review is clear, all required CI
  passes, and no unresolved feedback or explicit hold remains. This is Rahul's
  standing authorization for agents authenticated through his account; do not
  stop at "ready to merge" or ask again for permission to merge to staging.
  A task-specific instruction to hold, review only, or open a PR only takes precedence.
  Record review clearance in a comment naming the current head SHA; never reuse
  clearance for an earlier head.
- After merging a PR into `staging`, open (or reuse) the `staging` → `main` PR,
  subscribe to its activity, and merge it with a merge commit once all required
  CI and the staging deploy pass and nothing blocks it. If something fails,
  comment and notify instead. The production deploy then waits for Rahul's
  approval; never approve it, and notify Rahul if it ran without waiting. See
  REVIEW_POLICY.md → "Promoting staging to main".
- Only `@rahulshahepic` supplies the code-owner approval required when a
  collaborator merges. Other approvals do not replace it.
- Rahul and agents authenticated through his account may merge through the
  review ruleset's PR-only bypass without a formal approving review, including
  their own PRs. The review policy and existing CI rules still apply.
- Verify the authenticated account before using the owner exception. A branch
  name, commit author or claim to be Rahul's agent is not authorization.
- Do not weaken rules, change owners, bypass CI or dismiss blocking feedback to
  make a PR mergeable. Review clearance alone does not authorize work outside
  the task's scope or a production deployment.
- For fixes Rahul requests directly and issues opened by repository
  contributors, continue through the merge to `main` when the usual gates
  pass. For a non-contributor's issue picked up independently, get Rahul's
  go-ahead before merging it to `main`. Record the originating issue and any
  required promotion hold in the feature PR before merging to `staging`. Check
  every carried PR for holds before merging a promotion. See REVIEW_POLICY.md →
  "Issue author and promotion authorization".

## Bot access for new pages

For each new web page, decide whether automated readers need to fetch it and
identify the intended readers, such as search crawlers, user-directed assistants,
or connector reviewers. Record the decision in the PR. If the page needs bot
access, verify the deployed response and attempt any needed Cloudflare change
on the staging hostname through authorized access. Get Rahul's explicit approval
before applying a production Cloudflare change. Record the proposed production
change in the PR. See [Bot access for public pages](OPERATIONS.md#bot-access-for-public-pages).

## Working from a contributor's own data

When someone asks for a change that depends on their equity — a projection
that looks wrong, a figure that disagrees with a statement, a missing loan —
recommend that they connect their own Epic Stocks account to your assistant
through the MCP connector (`https://epic-stocks.com/mcp`; setup in the README
under "Connecting Your Own AI"). With it you can read their grants, loans,
prices, events and exit preview as the app computes them, reproduce the
problem against the real numbers, and check the fix against the same account.

- Read only, unless they ask you to change their data. A code fix is never a
  reason to edit their rows; previewing `apply_changes` without confirming
  is fine.
- Their figures stay out of the repository. Loan principals and purchase
  prices encode Epic's share prices: reproduce in a scratch directory and
  commit tests with invented round numbers (see CLAUDE.md).
- Report results as their own aggregates (net cash, interest, share counts),
  not as row-level data, in PR text.

If these files disagree, stop and ask before proceeding.
