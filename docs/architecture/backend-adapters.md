# Backend adapters

A backend adapter is an implementation of the `@remit/data-ports` interfaces plus one factory that returns them. It is not a dialect of a shared implementation, and it shares no database-handle type with any other adapter.

Reader ships one adapter: SQLite. Others — Postgres, DynamoDB — live in the repositories that deploy them and are supplied by injection. Nothing about an adapter's position, in this tree or out of it, changes what it has to satisfy.

## A1. The shared type vocabulary is the port contract

`packages/data-ports` is the contract: the repository interfaces, the item and input types, the list and search options, the error classes, and the conformance suite. No file in it names a database, a dialect, an ORM, or a SQL type.

Nothing on a shared surface names one adapter's handle type. `RemitClientRepositories` — the set of ports a client is composed from — is the widest type any two adapters have in common, and it is written entirely in terms of `data-ports`.

## A2. Each adapter owns its tables and its handle

An adapter imports the entity package for its own engine and types its repositories against its own handle. `@remit/drizzle-service` imports `@remit/drizzle-sqlite-schema` and types its repositories against `BetterSQLite3Database`; that type is internal and is not exported from the package index. A Postgres adapter imports `@remit/drizzle-pg-schema` and types its own.

No cast bridges two engines' types. There is no runtime table selection, and no module-global that fixes a dialect for the process — a repository's tables are decided by what its package imports, which is decided at build time.

Both entity packages are generated from TypeSpec and published regardless of which adapters exist. An entity package is a schema, not an adapter.

## A3. Selection is injection

A composition root supplies the client. `setClient(client)` registers one; `getClient()` returns it. A process that is handed a client never reaches anything else.

A process that is not handed one falls back to the single composition its own build contains, through a dynamic `import()` (A5). The fallback checks its precondition first — the SQLite composition requires `SQLITE_DB_PATH` — and when the precondition is absent it raises the registration error naming `setClient`, because a process that reaches the client with neither an injected client nor a database to open has a composition-root ordering bug and must be told so. Silently opening an empty database and serving an empty mailbox is the failure this check exists to prevent.

That check is a precondition, not a selection. Nothing picks between adapters at runtime.

## A4. The contract's guarantees

These are what every adapter must satisfy and what a caller may rely on. Everything an adapter does beyond them is private.

**Pagination.**

- **C1.** A continuation token is opaque. No caller decodes one.
- **C2.** A token is valid only against the adapter instance that minted it, for the same query and the same ordering.
- **C3.** An absent token means the listing is exhausted. A short page does not mean exhausted.
- **C4.** A token that does not decode is a `BadRequestError`, never read as "first page" — that reading silently restarts paging under a fresh token (#136). This governs `ResultList.continuationToken`. `AccountSchedulerPage.cursor` is a raw backend-native token the reader never decodes, so C1–C3 bind it and C4 does not.

**Transactions.**

- **C5.** Every write made through a unit of work's repositories commits together or not at all. A throw rolls the whole set back.
- **C6.** A transaction opened inside another on the same adapter joins the outer unit; it does not start a second independent one.
- **C7.** The port carries no isolation level, no explicit savepoint, and no read-consistency guarantee. An adapter's transaction machinery — savepoints, nesting detection, write serialization — is below this line and stays private to it.
- **C8.** `unitOfWork` is optional on the client, and its absence is resolved by the composition, which substitutes a pass-through unit. An adapter with no cross-entity atomicity is composed with that substitution; no caller branches on presence.

**Text matching.**

- **C9.** The floor is verbatim substring: a term appearing exactly in the subject or the From line matches. Postgres, SQLite on both its indexed and unindexed paths, and DynamoDB `contains()` all satisfy this. The conformance suite asserts this and nothing more.
- **C10.** Case folding and diacritic folding are **not** in the contract. Postgres folds both, through `unaccent` over a trigram index. SQLite folds both above three code points, where the FTS5 trigram tokenizer applies `remove_diacritics`, and neither below it, where a short term falls back to an unindexed `LIKE`. DynamoDB `contains()` folds neither. These are not three settings of one behaviour: `unaccent` and `remove_diacritics` are different functions, and one adapter's answer varies by term length. A caller that needs folding as a guarantee has chosen a backend, not a contract.

C9 is deliberately weaker than what any single adapter does. A floor that asserted case-insensitivity would fail an adapter the contract is meant to admit, on the first term that differs only in case.

## A5. An undeployed backend never enters the bundle

A build reaches only the adapter it deploys. The composition root's fallback is a dynamic `import()` and never a static one, so a bundler following the entry graph of a process that injects its own client never reaches another adapter's package or its ORM.

This is a property of the import shape, so it is checkable on the produced bundle and is checked there: no ORM in a bundle whose process injects its client, no native database driver in an image that touches no data, no cloud SDK in a self-host image.

## A6. Conformance is the acceptance test for every adapter

`@remit/data-ports/conformance` exports a suite per port and the harness types they take. An adapter — in this repository or in one this repository cannot see — implements a harness per port and runs the suites. That is what makes it an adapter rather than something that resembles one.

A harness supplies what the suite cannot express portably: how to build the repository, how to tear its store down, how to mint an id, and how to recognise a not-found error. Transaction rules need more than one repository and a reader outside the transaction, so the unit-of-work suite takes its own harness shape.

Two limits are inherent rather than incidental. `@remit/data-ports` publishes raw TypeScript and its suites are written against `node:test`, so an adapter needs a TypeScript loader and that runner. And a suite is only ever validated by the adapters that have run it — a rule that is really one engine's behaviour can enter the contract unchallenged until a second engine runs the suite. The first out-of-tree adapter to run it is the real acceptance event.

## FAQ

**Why not one repository implementation parameterized by dialect?** Because it cannot be typed. `PgDatabase` and `BetterSQLite3Database` are distinct types, `PgTable` and `SQLiteTable` are distinct types, and drizzle exposes no cross-dialect base with a working query builder. One body serving two engines needs a cast, and a cast means the types stop describing what executes.

**Does reader support Postgres?** Reader does not ship a Postgres adapter. `@remit/drizzle-pg-schema` and `@remit/data-ports` are published, so a Postgres adapter is a first-class implementation of the same contract, built and deployed where it runs.

**Can two adapters run in one process?** Nothing prevents it — no module-global fixes a dialect, and every adapter's tables come from its own imports. `setClient` holds one client because one client is what any current process needs; a name-keyed registry over it is additive.

**Why is `SQLITE_DB_PATH` read in the composition root at all?** To tell a missing database apart from a missing registration, so the second one says `setClient`. It never chooses between adapters.

**What does a caller do about C10?** Nothing, unless it needs folding guaranteed, in which case it is choosing a backend and should say so. Search behaviour that must be identical everywhere cannot be built on substring matching in the first place.

**How does an out-of-tree adapter learn the contract changed?** `@remit/data-ports` is published, so a new port or a changed signature is a version bump, and the new port's suite fails against an adapter that has not implemented it. A rule with no suite is not enforced anywhere — which is the argument for adding the suite with the rule.
