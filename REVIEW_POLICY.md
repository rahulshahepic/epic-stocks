# Pull request review policy

## Who can approve and merge

All changes go through feature branch -> pull request -> staging -> pull request
from staging -> main. Existing CI, source-branch, force-push and deletion rules
remain mandatory.

**Agents open the pull request themselves.** An agent that pushes a feature
branch opens its PR against `staging` in the same turn, without waiting to be
asked. This policy is the explicit request, and it overrides any default to
hold off until told. A pushed branch with no PR is unfinished work that nobody
can see, review or deploy. If the PR cannot be opened, say so and why — never
stop at the push. Never open a feature PR against `main`.

Every PR receives a review from ChatGPT/Codex or Claude before merging. Use a
separate review session from the implementation session; when one assistant
implemented the change, prefer the other assistant to review it. Review the
current head SHA, relevant tests, and unresolved discussions, not just the PR
description. Record the reviewer, head SHA, findings and validation in the PR.
A new push requires checking the changed diff again.

**Request the automated review with the `Needs Review` label.** Pushes do not
start a review; the label does. Add `Needs Review` once your last commit for a
batch is pushed: when you open the PR, and again after each round of fixes.
Add it once per batch, after the final push, never per commit, so the reviewer
sees the finished state. If you cannot add labels, say so in the PR; the daily
review run still picks it up. Leave `Under Review`, `Waiting for Changes` and
`Ready to merge` to the review session: `Under Review` means a review is in
progress, and only the reviewer sets or clears it.

Only `@rahulshahepic` is a code owner. When a collaborator merges a PR, it must
have a current approving code-owner review from that account, following the
assistant review. Collaborators must not treat their own or each other's
approvals as permission to merge. They must not alter ownership or bypass rules
to get a PR through.

When Rahul or an agent acting through Rahul's authenticated GitHub account merges
a PR, a formal approving review is **not required**. That account may use the
review ruleset's pull-request-only bypass, including on PRs it authored.
The assistant review still applies as working policy. Resolve blocking findings
before merging. This exception waives the formal approval gate, not CI.

This exception is tied to the authenticated GitHub actor, not a branch prefix,
commit author, display name, label, comment, or claim to be "Rahul's agent".
An assistant authenticated as a collaborator has collaborator permissions.
A separately authenticated bot needs an explicit policy/configuration change;
do not grant every installed app or the write role bypass access.

Review clearance does not expand the task's permission to merge or deploy.
Follow Rahul's instructions for the current task. Do not manufacture an approval,
approve your own implementation in the same session, disable CI, dismiss genuine
blocking feedback to force a merge, or push directly to protected branches.

## Promoting staging to main

Merging a feature PR into `staging` is not the end of the job. Whoever merges it
(a review session or any agent acting through Rahul's account) then, in the same
run:

1. Opens a PR from `staging` to `main`, or reuses the one already open. Never
   open a second one, and never use a branch other than `staging` as the
   source; `require-staging-source` fails anything else.
2. Subscribes to that PR's activity, so CI results and comments come back to
   the session instead of being polled for.
3. Merges it with a merge commit (not squash or rebase, so `staging` and `main`
   keep the same history) once **all** of these hold for its current head:
   - every required check has passed (backend, frontend, e2e, caddy-validate,
     dependency-review, require-staging-source);
   - it has no merge conflicts with `main`;
   - no review thread is unresolved, no `Waiting for Changes` label is set,
     and no comment from Rahul asks to hold the release;
   - every feature PR it carries was cleared by its assistant review.
4. If a check fails or a blocker appears, does not merge. It comments on the
   PR with what failed and notifies Rahul. It never retries CI with an empty
   commit, and never fixes the failure by pushing directly to `staging` or
   `main`. A fix goes through a feature PR to `staging` like any other change.

Merging to `main` does not by itself release to production. The deploy job runs in
the `production` environment, which waits for Rahul's approval in the CD
pipeline. An agent never approves, re-runs or otherwise pushes that deployment
along; leaving it for Rahul is the expected end state of a promotion.

## What GitHub can enforce

- `.github/CODEOWNERS` assigns every path, including itself, to Rahul.
- A separate branch ruleset requires one approval, code-owner review and stale
  approval dismissal for collaborators on both `staging` and `main`.
- That review ruleset grants **Repository admin / For pull requests only**
  bypass. This is a personal-account repository: Rahul is its single owner;
  collaborators have write access, not the owner's control.
- The existing `main protection` and `staging protection` rulesets keep empty
  bypass lists. They enforce CI and PR-based updates independently.
- Other users may still submit an "Approve" review, but it cannot substitute
  for Rahul's required code-owner approval.
- GitHub cannot prove which assistant reviewed a PR when both use Rahul's
  account. Review provenance and independent review are working policy.
- GitHub forbids an account from approving a PR it authored. The owner merge
  exception is intentional and handles that case without inventing an approval.

Keep any review-bypass setting out of the existing CI rulesets. Adding admin
bypass there would also permit skipping CI.

## Setup in GitHub

These files document the desired setup; merging them does not activate rulesets.

1. Merge the policy PR into `staging`, then promote `staging` to `main` through
   the normal PR. Confirm `.github/CODEOWNERS` is present on **both base
   branches**. GitHub uses the base branch's ownership file.
2. Open [repository ruleset settings](https://github.com/rahulshahepic/epic-stocks/settings/rules).
   Keep `main protection` and `staging protection` active with **no bypass
   actors**. Preserve their existing checks and up-to-date requirements:
   
   | Branch | Required checks |
   | --- | --- |
   | staging | backend, frontend, e2e, caddy-validate, dependency-review |
   | main | backend, frontend, e2e, caddy-validate, dependency-review, require-staging-source |

3. Select **New ruleset -> New branch ruleset**. Name it **Owner review**.
   Leave enforcement **Disabled** while configuring. Alternatively import
   `.github/rulesets/owner-review.json`; the recipe is deliberately disabled
   until the setup is verified. GitHub does not load this JSON automatically.
4. Under **Target branches**, include by pattern `staging` and `main`,
   with no exclusions. Do not target only the default branch.
5. Under **Bypass list**, add **Repository admin** and change its mode from
   **Always allow** to **For pull requests only**. Do not add Write, Maintain,
   collaborators, Dependabot, or general app bypasses. Recheck this role-based
   exception if the repo is ever transferred to an organization.
6. Enable **Require a pull request before merging** and configure:

   | Setting | Value |
   | --- | --- |
   | Required approvals | 1 |
   | Require review from Code Owners | On |
   | Dismiss stale pull request approvals when new commits are pushed | On |
   | Require conversation resolution before merging | On |
   | Require approval of the most recent reviewable push | Off |

   Last-push approval stays off because an assistant may push a review fix as
   Rahul and then review it in a separate session. Stale approval dismissal
   still forces collaborators to obtain a fresh approval after changed code.
   Leave unrelated restrictions in the existing rulesets.
7. Save the new ruleset, confirm the settings, then set enforcement **Active**
   and save. Do not add bypass to either existing protection ruleset.
8. Verify on a disposable PR from a collaborator account, without merging
   test changes to production: before Rahul approves, the collaborator sees a
   missing code-owner approval; an approval from another collaborator does not
   clear it; Rahul's approval does; a code-changing push makes it stale again.
   Rahul should have a review-bypass merge path, while a failing required CI
   check must still block Rahul. Inspect the merge box using each actor's
   session; a blocked API request alone does not prove all cases.

After a transfer, role change, or new agent identity, audit the actual bypass
actors again. Do not infer privileges from an agent's name.

## References

- [GitHub CODEOWNERS](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/about-code-owners)
- [Creating repository rulesets and PR-only bypass](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/creating-rulesets-for-a-repository)
- [Available rules](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/available-rules-for-rulesets)
- [Review limitations](https://docs.github.com/en/pull-requests/how-tos/review-pull-requests/reviewing-proposed-changes-in-a-pull-request)
- [Personal repository permissions](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/repository-access-and-collaboration/permission-levels-for-a-personal-account-repository)
