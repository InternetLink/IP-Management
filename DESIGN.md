# IPAM Frontend Design Notes

## Existing system

- HeroUI supplies the shared controls, cards, chips, dialogs, tables, and toast feedback.
- Pages use a constrained content column with compact spacing and dense, scan-friendly data grids.
- Existing action feedback uses `toast.success` for completed mutations and `toast.danger` for failures.
- Destructive or corrective feedback keeps the message short and puts supporting detail in the toast description.

## Contract-related UI rules

- Keep response validation outside presentational components so malformed server data cannot enter component state.
- Preserve the current compact toast language and existing translation keys when correcting response-driven messages.
- Show partial-operation counts and actionable detail together when the server reports both.

## 5. Request states

- Keep successfully loaded content visible while a refresh is pending and show a compact `Refreshing...` status near the content.
- Show request failures inline with the real error message and a `Retry` action. Initial failures replace placeholder data.
- Disable writes that depend on a successful read until the read returns its required version or concurrency token.
