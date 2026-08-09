# Project rules

- IMAP mutations: every operation mutating remote mail-server state follows [docs/architecture/imap-mutations.md](docs/architecture/imap-mutations.md) — the mutator pattern is mandatory, and every dependent operation states wait-or-reconcile as an explicit design decision.
- URL state: every path segment, query param and fragment binding follows [docs/architecture/url-state.md](docs/architecture/url-state.md) — no fact lives in more than one of the three tiers.
