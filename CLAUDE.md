# Project rules

- IMAP mutations: every operation mutating remote mail-server state follows [docs/architecture/imap-mutations.md](docs/architecture/imap-mutations.md) — the mutator pattern is mandatory, and every dependent operation states wait-or-reconcile as an explicit design decision.
