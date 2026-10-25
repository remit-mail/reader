# Backend adapters

A backend adapter is an implementation of the `@remit/data-ports` interfaces plus one factory that returns them. It is not a dialect of a shared implementation, and it shares no database-handle type with any other adapter.

Reader ships one adapter: SQLite. Others — Postgres, DynamoDB — live in the repositories that deploy them and are supplied by injection. Nothing about an adapter's position, in this tree or out of it, changes what it has to satisfy.

## A1. The shared type vocabulary is the port contract

`packages/data-ports` is the contract: the repository interfaces, the item and input types, the list and search options, the error classes, and the conformance suite. No file in it names a database, a dialect, an ORM, or a SQL type.

Nothing on a shared surface names one adapter's handle type. `RemitClientRepositories` — the set of ports a client is composed from — is the widest type any two adapters have in common, and it is written entirely in terms of `data-ports`.

## A2. Each adapter owns its tables and its handle

An adapter imports the entity package for its own engine and types its repositories against its own handle. `@remit/drizzle-service` imports `@remit/drizzle-sqlite-schema` and types its repositories against `RepositoryDb`: drizzle's `BaseSQLiteDatabase` over a synchronous or an asynchronous driver, with `transaction` and `batch` removed. better-sqlite3, a Durable Object's storage, D1 and libsql all satisfy it, so one body serves every SQLite engine. A Postgres adapter imports `@remit/drizzle-pg-schema` and types its own.

A repository writes a set through a `WriteBatch` port bound to its database: `syncBatch` (one synchronous transaction, for better-sqlite3 and Durable Objects) or `asyncBatch` (the driver's `batch()`, for D1 and libsql). The two travel together as a `SqliteStore` (`{ db, batch }`), which is what a writing repository takes. `composeSqliteRepositories` takes one store per schema set; `createSqliteRepositories` is that call over better-sqlite3 with `syncBatch`. A repository holds one database and reaches another database's rows through that repository's port.

No cast bridges two engines' types. There is no runtime table selection, and no module-global that fixes a dialect for the process — a repository's tables are decided by what its package imports, which is decided at build time.

Both entity packages are generated from TypeSpec and published regardless of which adapters exist. An entity package is a schema, not an adapter.

## A3. Selection is injection

A composition root supplies the client. `setClient(client)` registers one; `getClient()` returns it. A process that is handed a client never reaches anything else.

A process that is not handed one falls back to the single composition its own build contains, through a dynamic `import()` (A5). The fallback checks its precondition first — the SQLite composition requires `SQLITE_APP_DB_PATH` — and when the precondition is absent it raises the registration error naming `setClient`, because a process that reaches the client with neither an injected client nor a database to open has a composition-root ordering bug and must be told so. Silently opening an empty database and serving an empty mailbox is the failure this check exists to prevent.

That check is a precondition, not a selection. Nothing picks between adapters at runtime.

A handler reaches the client only through its per-request context: `(c, ctx: HandlerContext)`, where `ctx` carries the `client`, the caller's `identity` and the `config`; the request itself is openapi-backend's `c.request`. The host builds the context once per request and passes it in; no handler module imports `getClient`, reads the raw event, reads `process.env` or derives identity itself.

`config` is a typed `ApiConfig`: the auth mode with its signing secret, CORS origins, the public origin and content domain, Microsoft OAuth, the self-update seam and the build commit, each a mode where a flag would otherwise be. The host supplies it. `configFromEnv(process.env)` builds it in the Node and Lambda entry (`index.ts`), refuses to start without a required key, and defaults every optional key there and nowhere else.

Two adapters share one path. `serveApi` in `@remit/backend/serve` registers a host's operations and returns `dispatch` and `handleFetch`; the Lambda adapter in `lambda.ts` maps an API Gateway event onto the same request a Fetch `Request` becomes, so both reach one `dispatch` that runs the operation table, the error mapping, the CORS and correlation headers and the access line. Routing and validation run first, so an unknown path answers 404 and a malformed request 400 before an anonymous caller gets 401. Identity is resolved only for an operation that needs a caller: the Lambda adapter reads the authorizer claims and the local overrides, and on the self-host backend verifies the JWT; a Worker passes its own `client` and `identity` to `handleFetch`. `@remit/backend/serve` imports neither `aws-lambda` nor the Lambda adapter, so a Worker imports `serveApi` and `RequestHost` from it.

## A4. The contract's guarantees

These are what every adapter must satisfy and what a caller may rely on. Everything an adapter does beyond them is private.

**Pagination.**

- **C1.** A continuation token is opaque. No caller decodes one.
- **C2.** A token is valid only against the adapter instance that minted it, for the same query and the same ordering.
- **C3.** An absent token means the listing is exhausted. A short page does not mean exhausted.
- **C4.** A token that does not decode is a `BadRequestError`, never read as "first page" — that reading silently restarts paging under a fresh token (#136). This governs `ResultList.continuationToken`. `AccountSchedulerPage.cursor` is a raw backend-native token the reader never decodes, so C1–C3 bind it and C4 does not.

**Transactions.**

- **C5.** No transaction stays open across an `await`. A write set is an atomic batch, the shape of D1's `batch()`: its statements commit together or not at all, and none of them reads another's result. Decisions are made against reads taken before the batch.
- **C6.** A write that is not one batch is an idempotent step: keyed on derived ids, upserts and conditional `WHERE` clauses, so a queue redelivery or a second tab repeating it converges on the same rows.
- **C7.** The port carries no isolation level, no explicit savepoint, and no read-consistency guarantee. How an adapter runs a batch — one synchronous `IMMEDIATE` transaction on better-sqlite3, `transactionSync` in a Durable Object, `batch()` on D1 — is below this line and stays private to it.
- **C8.** The calendar store is the one cross-repository write port: `commit` takes a list of writes, applies the calendar writes as one batch, then settles each suggestion through the suggestion repository.

**Text matching.**

- **C9.** The floor is word prefix: a term appearing exactly at the start of a word in the subject or the From line matches. Postgres and DynamoDB `contains()` match any substring, which covers it; SQLite's FTS5 `unicode61` index matches word prefixes. The conformance suite asserts this and nothing more.
- **C10.** Case folding and diacritic folding are **not** in the contract. Postgres folds both, through `unaccent` over a trigram index. SQLite folds both through the `unicode61` tokenizer with `remove_diacritics 2`, and folds only ASCII case where a term with no letter or digit, or a field-term narrowing, falls back to an unindexed `LIKE`. DynamoDB `contains()` folds neither. These are not three settings of one behaviour: `unaccent` and `remove_diacritics` are different functions, and one adapter's answer varies by query path. A caller that needs folding as a guarantee has chosen a backend, not a contract.

C9 is deliberately weaker than what any single adapter does. A floor that asserted case-insensitivity would fail an adapter the contract is meant to admit, on the first term that differs only in case.

## A5. An undeployed backend never enters the bundle

A build reaches only the adapter it deploys. The composition root's fallback is a dynamic `import()` and never a static one, so a bundler following the entry graph of a process that injects its own client never reaches another adapter's package or its ORM.

This is a property of the import shape, so it is checkable on the produced bundle and is checked there: no ORM in a bundle whose process injects its client, no native database driver in an image that touches no data, no cloud SDK in a self-host image.

## A6. Conformance is the acceptance test for every adapter

`@remit/data-ports/conformance` exports a suite per port and the harness types they take. An adapter — in this repository or in one this repository cannot see — implements a harness per port and runs the suites. That is what makes it an adapter rather than something that resembles one.

A harness supplies what the suite cannot express portably: how to build the repository, how to tear its store down, how to mint an id, and how to recognise a not-found error. Transaction rules need more than one repository and a reader outside the transaction, so the unit-of-work suite takes its own harness shape.

Two limits are inherent rather than incidental. `@remit/data-ports` publishes raw TypeScript and its suites are written against `node:test`, so an adapter needs a TypeScript loader and that runner. And a suite is only ever validated by the adapters that have run it — a rule that is really one engine's behaviour can enter the contract unchallenged until a second engine runs the suite. The first out-of-tree adapter to run it is the real acceptance event.

## A7. Queues, storage and secrets are ports too

A shared package names no cloud SDK for the I/O it does beyond the database. Three ports carry it:

- **Queue.** `QueueProducer<T>`, `GroupedQueueProducer<T>` and `FifoQueueProducer<T>` in `@remit/data-ports`: `send` and `sendBatch` over a typed body, each tagged with its `kind`. A standard queue takes `{ body }`; a FIFO queue takes a `GroupedQueueMessage` (group, content-based deduplication) or a `FifoQueueMessage` (group and deduplication id). The mailbox-service classes, the API handlers and the workers produce through it; SQS is its adapter, `createStandardQueueProducer`, `createGroupedQueueProducer` and `createFifoQueueProducer` in `@remit/sqs-client`, chosen where each queue is composed.
- **Storage.** `StorageService` in `@remit/storage-service`. S3 and the filesystem are its adapters.
- **Secrets.** `DataKeyProvider` in `@remit/secrets-service`, under the envelope encryption `createSecretsService` does. KMS is its adapter, in `@remit/secrets-service/kms`.

The client is keyed by the queues a host composes: `RemitClient<K extends QueueName>` carries `queues: Pick<RemitClientQueues, K>` and only the services those queues feed. Each operation declares the queues it sends to, as `HandlerContext<"sync">`, and an operation that sends nothing takes a bare `HandlerContext`. A host entry picks its operations from `handlers` and `publicHandlers` in `@remit/backend/handlers` and registers them with `serveApi<K>(registry)` from `@remit/backend/serve`, which checks the client's queues against every operation in the registry, so a host with no queues can still serve the read path. A host that registers an operation without composing a queue it sends to does not compile, and an operation it leaves out answers 501.

A host composes at build time, in its entry. A host with every queue calls `createRemitClient`; a host with a subset builds its client from `createRemitCore` and the `compose…Services` pieces for the queues it has, and registers only the operations those queues serve. Reader's own entries compose all five from SQS URLs read once into typed config. The workers compose their own queues the same way: imap-worker registers its producers with `setWorkerQueues` from each entry, and account-worker's fan-out entry passes its producers to the handler. Tests produce through `recordingQueue` and `failingQueue` from `@remit/data-ports/recording-queue`.

## FAQ

**Why not one repository implementation parameterized by dialect?** Because it cannot be typed. `PgDatabase` and `BaseSQLiteDatabase` are distinct types, `PgTable` and `SQLiteTable` are distinct types, and drizzle exposes no cross-dialect base with a working query builder. One body serving two engines needs a cast, and a cast means the types stop describing what executes.

**Does reader support Postgres?** Reader does not ship a Postgres adapter. `@remit/drizzle-pg-schema` and `@remit/data-ports` are published, so a Postgres adapter is a first-class implementation of the same contract, built and deployed where it runs.

**Can two adapters run in one process?** Nothing prevents it — no module-global fixes a dialect, and every adapter's tables come from its own imports. `setClient` holds one client because one client is what any current process needs; a name-keyed registry over it is additive.

**Why is `SQLITE_APP_DB_PATH` read in the composition root at all?** To tell a missing database apart from a missing registration, so the second one says `setClient`. It never chooses between adapters.

**What does a caller do about C10?** Nothing, unless it needs folding guaranteed, in which case it is choosing a backend and should say so. Search behaviour that must be identical everywhere cannot be built on substring matching in the first place.

**How does an out-of-tree adapter learn the contract changed?** `@remit/data-ports` is published, so a new port or a changed signature is a version bump, and the new port's suite fails against an adapter that has not implemented it. A rule with no suite is not enforced anywhere — which is the argument for adding the suite with the rule.
