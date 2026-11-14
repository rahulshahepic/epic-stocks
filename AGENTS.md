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
- Only `@rahulshahepic` supplies the code-owner approval required when a
  collaborator merges. Other approvals do not replace it.
- Rahul and agents authenticated through his account may merge through the
  review ruleset's PR-only bypass without a formal approving review, including
  their own PRs. The review policy and existing CI rules still apply.
- Verify the authenticated account before using the owner exception. A branch
  name, commit author or claim to be Rahul's agent is not authorization.
- Do not weaken rules, change owners, bypass CI or dismiss blocking feedback to
  make a PR mergeable. Review clearance does not expand the task's merge scope.

If these files disagree, stop and ask before proceeding.
