# Backend adapters

A backend adapter is an implementation of the `@remit/data-ports` interfaces plus one factory that returns them. It is not a dialect of a shared implementation, and it shares no database-handle type with any other adapter.

This document answers issue #466. Its requirements are referenced as R1–R7 and are not restated.

## What is in the tree

Facts this design is built on, all checkable in `main` at `bec2c304`:

- `packages/data-ports/src` is 35 files: 23 interfaces in `src/interfaces/` (21 repositories plus `IUnitOfWork` and `IFilterAnchorTransaction`, neither of which is a repository), the item/input/option types, `errors`, `id`, `wellknown`, `account-settings`, `update-manifest`, and a conformance harness with one suite. No file outside its tests imports `drizzle-orm`, names a dialect, or names a SQL type. It publishes MIT with `access: public` and already exposes `./conformance` as a subpath export.
- 33 non-test files import a Postgres drizzle type — `NodePgDatabase`, `PgDatabase`, `drizzle-orm/pg-core`, or `drizzle-orm/node-postgres`. Five of them are `packages/auth-service`, which is better-auth's own identity schema and implements no port.
- 15 cast expressions across 6 files carry the dialect over the type system: `packages/backend/src/service/compose-sqlite.ts:51,53`, `compose-postgres.ts:43,45`, `packages/search-index-worker/src/data-ports.ts:54,55,92,93`, `packages/smtp-worker/src/data-ports.ts:50,51,85,86`, `packages/drizzle-service/src/sqlite-client.ts:44`, `schema/active-entities.ts:18`, `schema/outbox.ts:73`. Two of those files are themselves named `data-ports.ts` and import `drizzle-orm/node-postgres`.
- `SQL_DIALECT` in `packages/drizzle-service/src/dialect.ts` is read from `process.env.DATA_BACKEND` at module load. Exactly four modules consume it: `tx.ts`, `repos/thread-search-predicates.ts`, `schema/active-entities.ts`, `schema/outbox.ts`.
- The same global selects the test suite. `test:run:pg` runs `src/**/!(*.sqlite).test.ts` under `localhost-test-unit.env` (`DATA_BACKEND=postgres`, against `embedded-postgres`); `test:run:sqlite` runs `src/**/*.sqlite.test.ts`. 25 files in the first set, 10 in the second.
- `packages/backend/src/service/dynamodb.ts` branches on `process.env.DATA_BACKEND` over two lazy in-package imports, with an injected third case reached through `setClient`. It is published as `@remit/backend/client`.
- `remit-lambda-bundles.test.ts` does not exist in this repository; the only mention is a comment at `packages/backend/src/service/dynamodb.ts:26`. Nothing in this tree asserts on bundle contents.

### Postgres is deployed nowhere

Checked, because the whole plan turns on it:

- `deploy/` contains `docker-compose.sqlite.yml`, `.dovecot.yml` and `.e2e.yml`. There is no Postgres compose file, and no `infra/` or CDK directory.
- `packages/migrate/src/run-migrate.ts:237-245` **refuses to start** on any other value: `DATA_BACKEND=<x> is not supported: this stack runs SQLite`. It throws before opening a connection. A shipped stack cannot boot on Postgres.
- `deploy/vps/remit.env.template:169-174` says the same: "All relational state is SQLite… `docker-compose.sqlite.yml` pins `DATA_BACKEND` and both database paths itself, so this value is here for completeness rather than as a choice."
- `.github/workflows/ci.yml` names Postgres once, in a comment. No workflow sets `DATA_BACKEND=postgres`.

The two remaining Postgres branches in shipped code are unreachable for the same reason: `packages/search-service/src/from-env.ts:73` selects a pgvector store on `DATA_BACKEND === "postgres"`, and `packages/auth-service/src/config.ts:43` defaults better-auth to the `pg` provider on any value that is not `sqlite`. Neither can be reached in a stack whose migrator refuses to run.

What does exist is 25 embedded-Postgres test files in `drizzle-service`, running on every PR. That is a second-engine test signal, not a deployment.

## Decisions

### D1. The in-tree Postgres adapter is deleted, and it is deleted first

Issue #466 left this as a separate call. This is the call: **reader stops carrying a Postgres adapter**, because nothing in this repository deploys one and the migrator refuses to start against one. Issue #466's "not in scope" section is unchanged by it — removing the generated Postgres entity package was never on the table and is not here either.

The split matters more than the deletion, so it is stated by name.

**Leaves the runtime:**

- `packages/backend/src/service/compose-postgres.ts`
- the Postgres half of `packages/drizzle-service` — `dialect.ts`, `schema/active-entities.ts`, `pgOutboxTable` in `schema/outbox.ts`, the Postgres arms of `tx.ts` and `repos/thread-search-predicates.ts`, and `db.ts`'s `PgDatabase` typing
- the 15 casts, the `node-postgres` and `pg-core` imports, and the `pg` / `postgres` / `embedded-postgres` dependencies of `drizzle-service`
- the `DATA_BACKEND === "postgres"` arms in `getClient()`, both worker `data-ports.ts` files, `compose-relational.ts`, `deletion-capabilities.ts`, `search-service/src/from-env.ts`, `search-index-worker/src/services.ts`, and `auth-service/src/config.ts`

**Keeps being generated and published, untouched:**

- `@remit/drizzle-pg-schema` — the TypeSpec source, the `typespec-electrodb-emitter` run that produces it, its entry in `npm-scripts/lib/generated-packages.mjs`, and its release on merge to main
- `@remit/data-ports` — the contract the out-of-tree Postgres adapter implements, including its conformance subpath

Postgres support for the closed repository is therefore intact and, after this, first-class: it consumes the published entity package and the published contract instead of importing repositories out of an open-core module that was typed for it. What ends is reader carrying and shipping the implementation.

Everything else in this document is a consequence. With one dialect in the tree, `dialect.ts` has no readers, `active-entities.ts` has nothing to select, `outbox.ts` has one table, the `isSqlite()` branches have one arm, and all 15 casts have nothing to bridge. None of that is designed; it falls out.

*Buys:* no dialect global, no cast, no copy-then-cutover migration, no new package, no registry, and one implementation in the tree instead of one implementation typed as another. *Gives up:* the 25 embedded-Postgres test files, which are today the only signal that the repository behaviour is not accidentally SQLite-specific. D6 says what happens to them, and it is the reason they are converted rather than deleted.

An earlier draft of this document kept Postgres and built a registry, a new package, and a package-copy migration to keep both dialects green through the transition. All three existed only to survive keeping a backend nothing runs.

### D2. `Db<TSchema>` is retyped in place; nothing replaces it on a shared surface (R1, R2)

`Db<TSchema>` is a repository constructor parameter, not a port type. No interface in `data-ports` mentions it. Its correct replacement is the SQLite handle, in the same file:

```ts
// packages/drizzle-service/src/db.ts
export type Db<TSchema extends Record<string, unknown>> =
	BetterSQLite3Database<TSchema>;
```

and it stops being exported from the package index. What crosses the package boundary is `RemitClientRepositories` over the `data-ports` interfaces, which already exists in `packages/backend/src/service/create-remit-client.ts` and already names no dialect.

`schema/active-entities.ts` is deleted; the schema facade imports `@remit/drizzle-sqlite-schema` directly. `schema/outbox.ts` keeps `sqliteOutboxTable` and drops `pgOutboxTable` and the cast.

The retype is type-level only. The SQLite tables and the better-sqlite3 handle already run at runtime today, through the cast at `active-entities.ts:18` — the types have been lying about what executes since RFC 036. The exposure is that removing the cast surfaces type errors it was masking, which is a schedule risk on the slice, not a behaviour risk on the deployment.

### D3. `data-ports` stays the contract, and no second package is added (R7)

Neither reading of R7 is taken. `data-ports` stays. `data-service` is not created.

The case for a selection package was that an out-of-tree composition root should not have to depend on `@remit/backend` to call `setClient`. `@remit/backend/client` is already a subpath export pointing at exactly that file (`packages/backend/package.json`), so the seam is already reachable without the API's runtime. A package would move code without changing what anyone can import.

*Gives up:* an out-of-tree root keeps a package-level dependency on `@remit/backend`, and `setClient` keeps taking a whole `RemitClient` rather than only repositories. *Buys:* nothing new to publish, version, or keep in step.

### D4. Selection is injection, with no environment read and no registry (R3)

After D1 there is one in-tree adapter, so `getClient()` reduces to:

```ts
export const getClient = (): Promise<RemitClient> => {
	if (!clientPromise) {
		clientPromise = injected
			? Promise.resolve(injected)
			: import("./compose-sqlite.js").then((m) => m.buildSqliteClient());
	}
	return clientPromise;
};
```

No `DATA_BACKEND` read anywhere in the selection path. A process that is handed an adapter calls `setClient(client)` and never reaches the import. A process that is not gets the one composition this build contains.

R3 also asks that two adapters be able to coexist in one process, justified in the issue by a migration and a cross-backend conformance run. Both justifications are out-of-tree work once Postgres is: an out-of-tree adapter runs conformance in its own repository, and there is no second in-tree backend to migrate to. The thing that made two adapters *impossible* was `SQL_DIALECT`, a module-load read that no amount of injection could work around, and D1 removes it. A name-keyed registry over `setClient` is additive and costs one file whenever something actually needs it.

This is the point most worth disagreeing with: R3's letter asks for the registry and this decision supplies only the property underneath it.

### D5. The composition root is renamed, not moved (R6)

`packages/backend/src/service/dynamodb.ts` becomes `service/data-client.ts`, and `@remit/backend/client` points at the new path. `compose-postgres.ts` is deleted. `compose-sqlite.ts` loses its two casts and keeps its name, which is now accurate.

`@remit/drizzle-service` keeps its name. It is a drizzle service; it is now a SQLite one, which its description says. Renaming a published package to improve an adjective is not worth the coordination.

### D6. Conformance grows out of the Postgres test conversion, not ahead of demand (R4)

R4 has two halves and only one is open. The mechanism already works: `@remit/data-ports/conformance` is a published subpath, `RepositoryConformanceHarness` is a stable four-member shape, and `label.conformance.test.ts` / `label.conformance.sqlite.test.ts` already prove one suite running against two different harnesses. An out-of-tree adapter can run it today. The document records this rather than proposing it.

What is open is coverage: 1 of 21 repository ports has a suite. Writing the other 20 speculatively, for adapters that do not exist, is the largest block of work in the plan and the least anchored.

So the coverage is produced as a by-product of work that has to happen anyway. D1 requires converting 25 embedded-Postgres test files to SQLite. Each converted file is read once, and the split is made then: assertions about **port behaviour** (a create derives this field, a delete makes a get throw, a page is exhaustive and duplicate-free) move into a conformance suite in `data-ports`; assertions about **SQL behaviour** (a savepoint rolls back, an FTS5 predicate matches, a serialized write does not join an open transaction) stay as SQLite tests in the adapter. No file is converted twice and no suite is written for a port whose tests said nothing portable.

Two things this cannot cover:

- The harness yields one repository, a teardown, an id minter and a not-found predicate. That is enough for the repository ports and not enough for C5–C8, which need at least two repositories plus a reader outside the transaction. A unit-of-work suite takes a different harness, and it is the one place a new shape is needed:

  ```ts
  export interface UnitOfWorkConformanceHarness {
      createRepositories(): Promise<
          UnitOfWorkRepositories & { unitOfWork: IUnitOfWork }
      >;
      readOutsideTransaction<T>(
          read: (repos: UnitOfWorkRepositories) => Promise<T>,
      ): Promise<T>;
      teardown(): Promise<void>;
      makeId(): string;
  }
  ```

- `@remit/data-ports` publishes raw TypeScript (`"main": "src/index.ts"`), and the suites are written against `node:test`. An out-of-tree adapter therefore needs a TypeScript loader and the node runner, not only the runner. Both are cheap and neither is free.

### D7. The port-contract rules

These are the rules the conformance suite asserts. They replace nothing in the type system — `ResultList`, `ListOptions`, `SearchOptions` and `IUnitOfWork` are already dialect-free and are unchanged.

**Pagination.**

- **C1.** A continuation token is opaque. No caller decodes one.
- **C2.** A token is valid only against the adapter instance that minted it, for the same query and the same ordering.
- **C3.** An absent token means the listing is exhausted. A short page does not mean exhausted.
- **C4.** A token that does not decode is a `BadRequestError` — never read as "first page", which silently restarted paging under a fresh token (#136). This applies to `ResultList.continuationToken` only. `AccountSchedulerPage.cursor` (`packages/data-ports/src/types.ts:42-45`) is a raw backend-native token with no decode step on the reader's side, so C1–C3 apply to it and C4 does not.

**Transactions.**

- **C5.** Every write made through the callback's repositories commits together or not at all. A throw rolls the whole set back.
- **C6.** A `transaction` opened inside another on the same adapter joins the outer unit; it does not start a second independent one.
- **C7.** The port carries no isolation level, no explicit savepoint, and no read-consistency guarantee. Everything in `packages/drizzle-service/src/tx.ts` — the SAVEPOINT bracket, the `AsyncLocalStorage` nesting flag, the serialization queue, the write-builder Proxy — is below this line and stays private to the adapter.
- **C8.** `unitOfWork` is optional on the client, and its absence is resolved by the *composition*, not by each caller. `packages/mailbox-service/src/message-sync.ts:240-246` substitutes a `PassThroughUnitOfWork` when none is supplied, which is the correct behaviour for an adapter with no cross-entity transaction and is not a branch any caller should be writing. An earlier draft said callers branch on presence; they do not, and the substitution is the contract.

**Text matching.** This is the one place adapters legitimately disagree, and the earlier draft got the facts wrong. `npm-scripts/sqlite-search-index.sql:38` uses `tokenize='trigram remove_diacritics 1'`, so SQLite *does* fold diacritics — but only on the FTS5 path. A term under three code points fails `isTrigramIndexable` and takes the `LIKE` fallback at `packages/drizzle-service/src/repos/thread-search-predicates.ts:66-73`, which does not fold. One adapter, two behaviours, selected by term length.

- **C9.** The floor is verbatim substring: a term that appears exactly in the subject or the From line matches. That is satisfiable by Postgres `unaccent`+`lower`, by SQLite on both its paths, and by DynamoDB `contains()`. The conformance suite asserts this and nothing more.
- **C10.** Case folding and diacritic folding are **not** in the contract. Postgres folds both. SQLite folds both above three code points and neither below. DynamoDB `contains()` folds neither. A suite that asserted case-insensitivity would fail the DynamoDB adapter on `INVOICE` against `invoice` on its first run, and D6 makes the same suite the acceptance test for every adapter.

An earlier draft proposed an `AdapterDescriptor.textMatching` enum for this. It is dropped: no value in it is correct for SQLite, whose behaviour depends on the term rather than the adapter; two adapters both declaring "folds diacritics" would still disagree, because `unaccent` and `remove_diacritics 1` are not the same function; and it had no accessor and no reader. The difference is documented here, where a caller choosing a backend can read it, rather than typed where nothing consumes it.

### D8. The bundle property, and its missing in-tree guard (R5)

The property holds today because `service/dynamodb.ts:31-40` reaches the relational composition only through `import()`, and the Lambda esbuild build marks `@remit/drizzle-service` and `drizzle-orm` external. D4 preserves the exact mechanism: the fallback in `getClient()` stays a dynamic `import()` and never becomes a static one. That is a rule on the diff, not an emergent property, and it is stated here because it is the one line in this plan that could silently invert R5.

`remit-lambda-bundles.test.ts` asserts on the produced bundle rather than the source shape, so it keeps enforcing the property unchanged. It is in the closed repository, which means this tree cannot see a regression it causes. Reader carries no bundle assertion of its own: `npm-scripts/docker-bundle.mjs` produces one bundle per service image and nothing tests what is inside them. S5 adds that test, and it is independent of every other slice so it can land first.

### D9. `DATA_BACKEND` keeps its remaining jobs; no new variable

An earlier draft moved the auth and content-signing predicates onto a new `AUTH_MODE`. That is dropped.

`AUTH_MODE` does not exist in the tree, and introducing it means a variable that gates JWT verification and content-URL signing across a compose file, an env template, the e2e env, and the AWS side of the closed repository. `packages/backend/src/data-backend.ts:16-19` records that this exact predicate already shipped broken once — guarding it on `=== "postgres"` alone left the SQLite deployment with no claim injection and unsigned `/content/*`. A second variable that can be absent on an upgraded box reintroduces that failure with a new trigger.

After D1, `isSelfHostSqlBackend()` is `DATA_BACKEND === "sqlite"`: one value, one meaning, pinned in `docker-compose.sqlite.yml:32` rather than left to the user's env file. The Postgres arm is deleted along with the adapter.

*Gives up:* the variable still answers two questions — which adapter, and which deployment mode. *Buys:* they cannot diverge while there is one adapter, and no new way to 500 an upgraded box.

The two non-selection readers that survive keep reading it for their own reasons: `packages/migrate/src/run-migrate.ts:237` refuses anything but `sqlite`, which is the guard that makes the rest of this document true, and it stays. The Postgres arms of `packages/search-service/src/from-env.ts:73` and `packages/search-index-worker/src/services.ts:41` are deleted together — they are one decision expressed twice (the guard exists so a missing `PG_CONNECTION_URL` cannot silently land vectors in the in-memory store), and splitting them across two mechanisms would recreate exactly the bug the guard was written to prevent.

## Slicing plan

Each slice is independently mergeable with a green CI run. There is no window in which two copies of anything coexist, because nothing is copied.

**S1 — Delete the deployment-side Postgres path.** `compose-postgres.ts`, the `DATA_BACKEND === "postgres"` arm of `getClient()`, the Postgres branches of both worker `data-ports.ts` files, `compose-relational.ts` and `deletion-capabilities.ts`, the pgvector arm of `from-env.ts:73` with its guard at `services.ts:41`, and the `pg` default in `auth-service/src/config.ts`. `drizzle-service` is untouched and still runs both suites. Nothing in the tree used any of it; the tests that assert `DATA_BACKEND=postgres` composes go with it.

**S2 — Convert the 25 embedded-Postgres test files to SQLite.** This is D6's split, done once per file: port assertions become conformance suites in `data-ports`, SQL assertions become adapter tests. `test:run:pg`, `localhost-test-unit.env`'s `DATA_BACKEND=postgres`, and the `embedded-postgres` dev dependency go. The dialect global still exists and still reads `sqlite` — the suite now sets it uniformly, so the source is unaffected.

**S3 — Delete the dialect global and the Postgres half of `drizzle-service`.** `dialect.ts` and `schema/active-entities.ts` deleted, `schema/outbox.ts` reduced to one table, `tx.ts` and `thread-search-predicates.ts` reduced to one arm, `db.ts` retyped to `BetterSQLite3Database`, the remaining casts removed, `@remit/drizzle-pg-schema` dropped from the package's dependencies. This is the slice that surfaces whatever the cast was masking, and by S2 it has no test files left to break.

**S4 — Rename the composition root.** `service/dynamodb.ts` → `service/data-client.ts`, `@remit/backend/client` repointed.

**S5 — In-tree bundle guard.** A test over `npm-scripts/docker-bundle.mjs` output asserting the per-image dependency floor: no `better-sqlite3` in an image that touches no data, no DynamoDB SDK in a self-host image, no `drizzle-orm` reachable from a Lambda-shaped entry point. Independent of S1–S4; it can land first, and should, because it is the only in-tree check on D8.

**Coordination precondition on S1 and S3.** Both are breaking changes to published packages. `@remit/drizzle-service` publishes on merge to main (`.github/workflows/publish.yml`, gated on `NPM_PUBLISH_ENABLED`), and S3 removes exports an out-of-tree Postgres adapter would import. S1 removes `buildPostgresClient`. Neither lands before the out-of-tree Postgres adapter exists and consumes `@remit/drizzle-pg-schema` directly. `setClient` is not removed by any slice, so out-of-tree DynamoDB callers are unaffected; S4 moves the file behind the same `@remit/backend/client` specifier.

## Change surface

Non-test files whose exported signature changes:

| Group | Files |
| --- | --- |
| `drizzle-service` — repos, schema facades, `db.ts`, `dialect.ts`, `tx.ts`, `sqlite-client.ts`, test harnesses, `repair/` | 34 |
| Backend composition — `service/dynamodb.ts`, `compose-postgres.ts`, `compose-sqlite.ts` | 3 |
| Worker and cascade seams — `search-index-worker/src/data-ports.ts`, `smtp-worker/src/data-ports.ts`, `account-worker/src/compose-relational.ts`, `account-worker/src/deletion-capabilities.ts` | 4 |
| **Total signature changes** | **41** |

Of the 34 in `drizzle-service`, two are deletions (`dialect.ts`, `schema/active-entities.ts`); most of the rest are a one-line handle-type change.

Also touched, without a signature change:

- 15 non-test files read `process.env.DATA_BACKEND`. Six select repositories and are already counted above (`service/dynamodb.ts`, both worker `data-ports.ts`, `compose-relational.ts`, `deletion-capabilities.ts`, `dialect.ts`). Four lose a Postgres arm (`search-service/src/from-env.ts`, `search-index-worker/src/services.ts`, `search-index-worker/src/sqlite-outbox-drain.ts`, `auth-service/src/config.ts`). Four simplify to a single-valued predicate (`backend/src/data-backend.ts`, `dev-server/server.ts`, `dev-server/relational-health.ts`, `account-worker/src/config.ts`). One is unchanged (`packages/migrate/src/run-migrate.ts`).
- 25 test files convert from embedded-Postgres to SQLite or to conformance suites; 10 SQLite test files stay; 4 test files elsewhere lose their Postgres cases.
- 2 build inputs: `localhost-test-unit.env` and `packages/drizzle-service/package.json`'s test scripts.

Around 100 files are touched, 41 of which change a signature. `packages/drizzle-service` is 98 files, 95 under `src/`; this plan edits and deletes within it rather than copying it, so the touched count is the file count and not twice it.

## FAQ

**Does reader lose Postgres?** Reader loses the Postgres adapter from this tree, which nothing in this tree deploys — the migrator refuses to start on it. The generated `@remit/drizzle-pg-schema` keeps being emitted and published, and the adapter itself belongs where it is deployed.

**What breaks for someone running Postgres today?** Nothing supported. A stack that runs `deploy/vps` cannot be on Postgres, because `packages/migrate/src/run-migrate.ts:237` refuses to apply migrations to anything else. Someone running the packages directly against Postgres, outside the shipped stack, is on an unsupported path and is the case D1 decides against.

**Why not keep both dialects and just remove the cast?** Because one repository body cannot be typed for both. `PgDatabase` and `BetterSQLite3Database` are distinct types, `PgTable` and `SQLiteTable` are distinct types, and drizzle exposes no cross-dialect base with a working query builder. Two dialects in one body means either the cast that exists today or 29 repository files kept in step by hand.

**Aren't the 25 Postgres tests worth keeping as a second-engine check?** They check that the repositories work on Postgres, which becomes a property of a repository this one does not contain. What is worth keeping is the portable half of what they assert, which is why S2 converts them into conformance suites rather than deleting them.

**Where did the registry go?** It was justified by two adapters in one process, and both cited uses — a cross-backend migration, a conformance run across dialects — stop existing in this tree once Postgres does. `setClient` is already injection. The registry is additive over it whenever something needs it.

**What actually made two adapters impossible — the singleton or the env branch?** Neither. `SQL_DIALECT` did: a module-load read that fixes the table types for every repository in the process, which no amount of injection could route around. It goes in S3.

**Why not rename `@remit/drizzle-service` now that it is SQLite-only?** A published rename costs a coordinated change in every consumer, in and out of tree, to make an adjective more accurate. The description field says SQLite.

**Does anything still read `DATA_BACKEND` after this?** Yes, deliberately. `run-migrate.ts` refuses anything but `sqlite`, which is the guard the rest of this document depends on. The auth and content predicates read it as a deployment-mode question, pinned in `docker-compose.sqlite.yml:32` — an earlier draft moved them to a new `AUTH_MODE`, and D9 says why that trades a naming complaint for a way to 500 an upgraded box.

**How does an out-of-tree adapter know the contract changed?** `@remit/data-ports` is a published package, so a new port or a changed signature is a version bump, and the suite for the new port fails against an adapter that has not implemented it. It does not know about a rule that has no suite, which is the cost of D6's demand-driven coverage.
