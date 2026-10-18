# Context System

- Purpose: Keep durable instructions, live task context and reusable validation guidance in predictable places.
- Scope: `AGENTS.md`, `docs/notes/tickets/`, `docs/validation/`.
- Last verified: 2026-10-18

## Where things live

- `AGENTS.md` (repository root): the durable map of the repository and its conventions. Keep it current when the layout or contracts change.
- `docs/notes/tickets/`: live task context. One file per ticket, named `S_short-kebab-name__YYYYMMDD.md` where `S` is `O` (open), `A` (active) or `R` (resolved). The H1 repeats the identifier and spells out the status. Tickets start with `Scope`, `Status`, `Opened`, `Updated`, `Current State` (or `Outcome`), `Verification` and `Cleanup`.
- `docs/notes/tickets/INDEX.md`: the live queue of open and active tickets only; update it as work proceeds.
- `docs/validation/`: reusable runbooks and contracts, each with `Purpose`, `Scope` and `Last verified` lines, indexed in `docs/validation/INDEX.md`.

## Lifecycle

Resolve a ticket by renaming it and its H1 to `R_…`, setting `Status: resolved` and recording final validation. During cleanup, distill reusable guidance into `docs/validation/`, update its index, then delete the resolved ticket and its index row. Do not keep task logs, completion ledgers or pasted terminal output in permanent documents.
