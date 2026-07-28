# Backend adapters

A backend adapter is an implementation of the `@remit/data-ports` interfaces plus one exported factory that returns them. It is not a dialect of a shared implementation, and it does not share a database-handle type with any other adapter.

This document answers issue #466. Its requirements are referenced as R1–R7 and are not restated. Decisions are numbered D1–D9 so a reviewer can disagree with one by name.

## What is in the tree

Facts this design is built on, all verifiable in the current `main`:

- `packages/data-ports/src` is 35 files: 23 repository interfaces, the item/input/option types, `errors`, `id`, `wellknown`, `account-settings`, `update-manifest`, and a conformance harness with one suite. No file outside its tests imports `drizzle-orm`, names a dialect, or names a SQL type. Its `package.json` publishes MIT with `access: public` and already exposes `./conformance` as a subpath export.
- `packages/drizzle-service` implements both dialects in one body. 25 non-test files name `NodePgDatabase`, `PgDatabase`, or import from `drizzle-orm/pg-core`; 8 more take `Db<TSchema>`, which is that same Postgres type.
- `SQL_DIALECT` in `src/dialect.ts` is read from `process.env.DATA_BACKEND` at module load. Exactly four modules consume it: `tx.ts`, `repos/thread-search-predicates.ts`, `schema/active-entities.ts`, `schema/outbox.ts`. Two of those four resolve the branch with `as unknown as typeof pg…`.
- The same global selects the test suite. `test:run:pg` runs `src/**/!(*.sqlite).test.ts` under `localhost-test-unit.env` (`DATA_BACKEND=postgres`); `test:run:sqlite` runs `src/**/*.sqlite.test.ts` under `DATA_BACKEND=sqlite`. 25 files in the first set, 10 in the second.
- The shipped self-host stack is SQLite only. `deploy/vps/docker-compose.sqlite.yml` pins `DATA_BACKEND: sqlite`, `deploy/vps/e2e.env` sets `sqlite`, and `deploy/` contains no Postgres compose file. Nothing reader ships runs the Postgres adapter.
- `packages/backend/src/service/dynamodb.ts` selects a backend by branching on `process.env.DATA_BACKEND` over two lazy in-package imports, with an injected third case. `setClient` takes a whole `RemitClient` — repositories plus storage, search, secrets, and the queue services. `RemitClientRepositories`, the data-only half, already exists next to it in `create-remit-client.ts`.
- `remit-lambda-bundles.test.ts` does not exist in this repository. It asserts on built Lambda bundles in the closed platform repo. Nothing in this tree asserts on bundle contents.
- `packages/auth-service` has the same two-dialect split and already resolves it by injection: `AuthConfig.provider` is a constructor argument, not a module global. It reads `DATA_BACKEND` only in `resolveDataConnectionConfig`, to derive that argument.

The consequence R1 names is real but narrower than it reads: the dialect does not leak into `data-ports`. It leaks into `@remit/drizzle-service`'s exported constructors, and from there into `compose-sqlite.ts`, which casts a better-sqlite3 handle to `NodePgDatabase` to satisfy them.

## Decisions

### D1. `data-ports` stays the contract; `@remit/data-service` is added beside it (answers R7)

`data-ports` is already the contract. It holds every interface, is dialect-free, is published MIT and public, and has the conformance subpath. Replacing it would be a rename with no change of content, and it would break the out-of-tree consumers already importing it.

`@remit/data-service` is the selection and composition layer. It owns three things and nothing else:

1. The `RemitClient` and `RemitClientRepositories` shapes, moved out of `packages/backend/src/service/create-remit-client.ts`.
2. The adapter registry (D3).
3. The per-process port subsets that exist today as `packages/search-index-worker/src/data-ports.ts` and `packages/smtp-worker/src/data-ports.ts`, each with its own registry.

The registry is runtime state and `RemitClient` references `StorageService`, `SearchService`, `SecretsService` and `mailbox-service` types. Neither belongs in the contract package, which must stay importable by an adapter that has none of those.

*Buys:* an out-of-tree composition root depends on `@remit/data-service` instead of `@remit/backend`, so registering an adapter no longer drags the API process into its graph. Three registries collapse to one. *Gives up:* one more package in the workspace, and a moved import path in every consumer of `RemitClient`.

### D2. Nothing replaces `Db<TSchema>` on the shared surface (answers R1, R2)

`Db<TSchema>` is a repository constructor parameter, not a port type. No interface in `data-ports` mentions it. The correct replacement is its absence: each adapter types its own repos against its own handle, privately, and exports one factory.

```ts
// @remit/sqlite-adapter — internal, not exported from the package index
type Db<TSchema extends Record<string, unknown>> = BetterSQLite3Database<TSchema>;

class LabelRepo implements ILabelRepository {
	constructor(private readonly db: Db<Record<string, unknown>>) {}
}
```

```ts
// @remit/sqlite-adapter — the whole exported surface
import type { RemitClientRepositories } from "@remit/data-service";

export function buildSqliteRepositories(options: {
	filename: string;
}): Promise<RemitClientRepositories>;
```

The shared vocabulary is therefore `RemitClientRepositories` over the 23 `data-ports` interfaces, plus one factory signature per adapter. `schema/active-entities.ts` is deleted: the SQLite adapter imports `@remit/drizzle-sqlite-schema` directly, an out-of-tree Postgres adapter imports `@remit/drizzle-pg-schema` directly, and neither package stops being generated or published (`npm-scripts/lib/generated-packages.mjs` is unchanged).

The three hard parts R7 names are addressed next. Two of them are already dialect-neutral in the contract and need only to be stated as rules; the third cannot be made neutral and is handled by declaring the difference.

#### Pagination

Already neutral. The types stay as they are:

```ts
export type ResultList<T> = { items: T[]; continuationToken: string | undefined };
export type ListOptions = { limit?: number; continuationToken?: string };
```

What is missing is the contract around them, which the conformance suite must assert:

- **C1.** A continuation token is opaque. No caller decodes one.
- **C2.** A token is valid only against the adapter instance that minted it, for the same query and the same ordering. Feeding a token to a different adapter, or to the same query with a changed order, is undefined and may throw.
- **C3.** An absent token means the listing is exhausted. A short page does not mean exhausted, and an exhausted listing does not require an empty final page.
- **C4.** A token that does not decode is a `BadRequestError`. It is never read as "first page" — that reading silently restarted paging under a fresh token (#136).

`AccountSchedulerPage.cursor` is the same shape under a different name, for internal paging that never crosses a trust boundary. It keeps its name and gains C1–C4 minus the salt/tamper requirement it never had.

#### Transactions

Already neutral. `IUnitOfWork` is unchanged:

```ts
export interface IUnitOfWork {
	transaction<T>(fn: (repos: UnitOfWorkRepositories) => Promise<T>): Promise<T>;
}
```

The rules the port carries:

- **C5.** Every write made through the callback's repositories commits together or not at all. A throw rolls the whole set back.
- **C6.** A `transaction` opened inside another on the same adapter joins the outer unit. It does not start a second independent one.
- **C7.** The port has no isolation level, no explicit savepoint, and no read-consistency guarantee. An adapter's mechanism is private.
- **C8.** `unitOfWork` is optional on the client. Its absence means the adapter has no cross-entity atomicity, and callers branch on presence — not on a backend name and not on a supplied boolean.

Everything in `packages/drizzle-service/src/tx.ts` is below C7: the SAVEPOINT bracket, the `AsyncLocalStorage` nesting flag, the async queue that serializes top-level units on the shared connection, and the write-builder Proxy. It is a property of one file-backed SQLite connection, not of a port. It moves into the SQLite adapter intact and loses its `isSqlite()` branch, because the file then has one dialect.

#### SQL-shaped predicates

`SearchOptions` is already neutral and stays as it is. `subjectMatch`/`fromMatch` return drizzle `SQL` and are private to the relational adapter; no port sees them.

This is the one place where the contract cannot mean the same thing on every adapter, and the design does not pretend otherwise. Postgres matches through `remit_immutable_unaccent(lower(…))` against a trigram GIN index and folds diacritics. SQLite matches through an FTS5 trigram index that lower-cases but does not unaccent, and falls back to a `LIKE` scan under three characters. DynamoDB `contains()` does neither.

- **C9.** `query` splits on whitespace; every term must match subject OR From. Matching is substring and case-insensitive for ASCII. This is the floor, and the conformance suite asserts exactly this.
- **C10.** Diacritic folding is not in the contract. An adapter declares what it does as a value on its descriptor; a caller that needs the guarantee reads the value.

```ts
export interface AdapterDescriptor {
	name: string;
	textMatching: "ascii-fold" | "unicode-fold";
}
```

No boolean, and no contract version field: `@remit/data-ports` is a published package and its semver is the contract version.

### D3. Selection is registration; `DATA_BACKEND` selects among registered adapters only (answers R3)

```ts
// @remit/data-service
export type RepositoriesFactory = () => Promise<RemitClientRepositories>;

export function registerBackend(
	name: string,
	factory: RepositoriesFactory,
	descriptor: AdapterDescriptor,
): void;

export function getRepositories(name?: string): Promise<RemitClientRepositories>;
export function registeredBackends(): string[];
```

A process that is handed an adapter looks like this, and reads no environment variable to get one:

```ts
// deploy/vps entry point
import { registerBackend, getRepositories } from "@remit/data-service";
import { buildSqliteRepositories, descriptor } from "@remit/sqlite-adapter";

registerBackend("sqlite", () => buildSqliteRepositories({ filename: env.SQLITE_DB_PATH }), descriptor);
const repositories = await getRepositories();
```

```ts
// a Lambda entry point in the closed repo
registerBackend("dynamodb", () => buildDynamoRepositories(config), descriptor);
```

Two adapters coexist because the registry is a map of memoized factories, not a single promise:

```ts
registerBackend("postgres", () => buildPostgresRepositories(pgConfig), pgDescriptor);
registerBackend("sqlite", () => buildSqliteRepositories({ filename }), sqliteDescriptor);

const from = await getRepositories("postgres");
const to = await getRepositories("sqlite");
```

`getRepositories()` with no argument resolves the sole registered adapter when there is one, and otherwise the one named by `DATA_BACKEND`. That is the variable's only remaining job, and it selects among adapters actually registered in this build: an unknown name is an error that lists what is registered, instead of a dynamic import of a module that may not be installed.

This is only true once no module reads the variable at import time. `SQL_DIALECT` is exactly that read, and D8 is how it goes.

### D4. `service/dynamodb.ts` is deleted, not renamed (answers R6)

Its three cases split by concern. The registry moves to `packages/data-service/src/registry.ts`. `create-remit-client.ts` moves to `packages/data-service/src/client.ts`. `compose-sqlite.ts` becomes `buildSqliteRepositories` inside the SQLite adapter. `compose-postgres.ts` is deleted with the rest of the in-tree Postgres adapter (D5).

`setClient(client: RemitClient)` becomes `registerBackend(name, factory)` where the factory returns `RemitClientRepositories`. The narrowing is deliberate: an out-of-tree adapter today has to build reader's storage, search, and secrets services to register at all, because `setClient` takes the whole client. Under the new seam an adapter supplies data and the process supplies the rest, which is already how `RemitClientDeps` is shaped.

### D5. The in-tree Postgres adapter is removed

This is the decision most likely to be disagreed with, and it is unavoidable once R1 and R2 are taken together. With no shared handle type, one repository body cannot serve both dialects: drizzle's `PgDatabase` and `BetterSQLite3Database` are nominally distinct, their table types (`PgTable`/`SQLiteTable`) are distinct, and drizzle exposes no cross-dialect base with a working query builder. Two dialects in one tree therefore means either the cast that exists today, or 29 repository files kept in lockstep by hand.

Reader ships SQLite. `deploy/` has no Postgres compose file. The Postgres adapter's home is the closed repository, where it is deployed, alongside the DynamoDB adapter it will now sit beside as a peer.

*Buys:* one dialect in the tree, the four `isSqlite()` branches and both casts deleted, no duplicated repository body, and the closed backends stop being an exception carved into an open-core module. *Gives up:* 25 embedded-Postgres test files, which are today the only second-engine signal on the repository behaviour. That signal moves out of tree, which is why D6 comes first in the slicing plan — the conformance suite has to be able to carry it before the Postgres tests leave.

`@remit/drizzle-pg-schema` keeps being generated and published, unchanged. This removes an adapter, not an entity package.

### D6. Conformance ships from `@remit/data-ports/conformance`, one suite per port (answers R4)

The subpath export exists. What is missing is 22 of the 23 suites and a single entry point.

```ts
// @remit/data-ports/conformance
export interface RepositoryConformanceHarness<TRepo> {
	createRepository(): Promise<TRepo>;
	teardown(): Promise<void>;
	makeId(): string;
	isNotFoundError(error: unknown): boolean;
}

export function labelRepositoryConformance(h: RepositoryConformanceHarness<ILabelRepository>): void;
export function mailboxRepositoryConformance(h: RepositoryConformanceHarness<IMailboxRepository>): void;
// …one per port

export function allRepositoryConformance(harnesses: {
	label: RepositoryConformanceHarness<ILabelRepository>;
	mailbox: RepositoryConformanceHarness<IMailboxRepository>;
	// …every port, all required
}): void;
```

An out-of-tree adapter adds `@remit/data-ports` as a dev dependency, writes one harness per port, and runs `node --test` over a file that calls `allRepositoryConformance`. Nothing else is exported and nothing else is needed. The harness keys are required, not optional: an adapter that cannot satisfy a port calls the individual suites it can and the omission is visible at the call site rather than hidden behind a flag.

The cost to state: the suites are written against `node:test`. That is in the platform rather than a dependency, and both `data-ports` and `drizzle-service` already run under it, but an adapter that standardises on another runner has to run this one as a second runner. A framework-neutral spec that each runner adapts costs more than the difference is worth.

### D7. The bundle property gets stronger, and its in-tree guard is missing (answers R5)

Today `service/dynamodb.ts` reaches `@remit/drizzle-service` through `import()`, and the Lambda esbuild build marks both it and `drizzle-orm` external. Under D3 a Lambda entry point registers DynamoDB and never names the relational adapter, so the module is not in the graph at all — not deferred, absent. The property holds by construction rather than by an externals list.

`remit-lambda-bundles.test.ts` asserts on the produced bundle, not on the source shape, so it keeps enforcing the property unchanged. It is in the closed repository, which means this tree cannot see a regression it causes. That gap exists today and is not created here, but the honest reading of R5 is that reader carries no bundle assertion of its own: `npm-scripts/docker-bundle.mjs` produces one bundle per service image and nothing tests what is inside them. Slice S8 adds that test.

### D8. The dialect global is removed by a package copy, not by an edit

`SQL_DIALECT` is read at module load in `schema/active-entities.ts`, which every repository in the package reads its tables from. The first edit that removes that branch changes the table types for all 29 repository files at once and breaks 25 of the 35 test files in the same commit. There is no first repository to convert.

So the branch is not edited. `packages/sqlite-adapter` is added as a copy of `drizzle-service` with the branches already resolved: `active-entities.ts` deleted, `outbox.ts` reduced to the SQLite table, `tx.ts` reduced to the savepoint path, `thread-search-predicates.ts` reduced to the FTS5 path, every repository retyped to `BetterSQLite3Database`. It runs the conformance suite plus the ported `*.sqlite.test.ts` files with no `DATA_BACKEND` set. `drizzle-service` is untouched and keeps running both its suites until the cutover. Both packages are green in the same CI run, and the breaking change lands in a directory nothing depends on yet.

### D9. The auth and content predicates stop reading `DATA_BACKEND`

`isSelfHostSqlBackend()` and `usesBetterAuthJwt()` in `packages/backend/src/data-backend.ts` gate JWT verification and content-URL signing (`dev-server/content-auth.ts` reads the predicate, not the variable). `packages/auth-service/src/config.ts` derives its drizzle provider from the variable directly, and `dev-server/server.ts` and `dev-server/relational-health.ts` branch on it. None of these is a question about the data backend; each asks whether this is the self-host stack.

They read `AUTH_MODE` (`better-auth` | `cognito`), set in `docker-compose.sqlite.yml`, `remit.env.template`, `e2e.env`, and on the AWS side. Without this, `DATA_BACKEND` remains a process-wide fact under a new name and D3 buys nothing.

## Slicing plan

Each slice is independently mergeable with a green CI run.

**S1 — Conformance covers every port.** Suites for the remaining 22 interfaces plus `allRepositoryConformance`, run against the existing repos on both dialects through the existing `label.conformance.test.ts` / `label.conformance.sqlite.test.ts` pattern. No production code changes. This is the net that makes every later slice checkable, and it must land before D5 removes the Postgres tests.

**S2 — `@remit/data-service` exists.** `RemitClient`, `RemitClientRepositories`, `buildSharedDeps`, and the registry move out of `packages/backend/src/service/`. `backend` re-exports them so no consumer moves yet. `registerBackend`/`getRepositories` are added; `service/dynamodb.ts` becomes a shim over the registry with the env branch intact, so out-of-tree `setClient` callers keep working. Behaviour is unchanged.

**S3 — Entry points register.** Every in-tree entry point (backend server, imap-worker, smtp-worker, account-worker, search-index-worker, dev-server) calls `registerBackend` at startup. The env branch stays as the fallback. Two adapters in one process becomes possible at this point; the three worker-local registries in `*/src/data-ports.ts` collapse into the shared one.

**S4 — `AUTH_MODE`.** D9. Isolated from everything above and below it.

**S5 — `packages/sqlite-adapter`.** D8. The copy, with the branches resolved and the casts gone. `drizzle-service` untouched.

**S6 — Cutover.** The sqlite compose stack, the e2e stack, and the dev server register `@remit/sqlite-adapter`. `compose-sqlite.ts` is deleted. `drizzle-service` still builds and still runs both suites, now used by nothing.

**S7 — Deletion.** `drizzle-service`, `compose-postgres.ts`, `service/dynamodb.ts`, `localhost-test-unit.env`'s `DATA_BACKEND=postgres`, and the env branch in the registry. `getRepositories()` resolves the sole registered adapter.

**S8 — Bundle guard.** A test over `npm-scripts/docker-bundle.mjs` output asserting the per-image dependency floor: no `better-sqlite3` in an image that touches no data, no DynamoDB SDK in a self-host image, no `drizzle-orm` reachable from a Lambda-shaped entry point.

S1 and S4 are independent of the rest and of each other. S2→S3→S5→S6→S7 is a chain. S8 can land any time after S3.

## Change surface

Counted from `main`, non-test files whose exported signature changes:

| Group | Files |
| --- | --- |
| `drizzle-service` repos, schema facades, `db.ts`, `dialect.ts`, `tx.ts`, `sqlite-client.ts`, test harnesses, `repair/` | 34 |
| Backend composition — `service/dynamodb.ts`, `create-remit-client.ts`, `compose-postgres.ts`, `compose-sqlite.ts` | 4 |
| Worker seams — `search-index-worker/src/data-ports.ts`, `smtp-worker/src/data-ports.ts`, `account-worker/src/compose-relational.ts`, `account-worker/src/deletion-capabilities.ts` | 4 |
| **Total signature changes** | **42** |

Not counted as signature changes:

- 5 files in `packages/auth-service` name a Postgres drizzle type (`auth.ts`, `auth.gen.ts`, `verifier.ts`, `schema/auth-schema.ts`, `schema/meta-schema.ts`). They are better-auth's own identity schema, do not implement `data-ports`, and already inject their provider. Only `config.ts` changes, under D9.
- 15 non-test files read `process.env.DATA_BACKEND`. Five of them select repositories and are already counted above (`service/dynamodb.ts`, both worker `data-ports.ts`, `compose-relational.ts`, `dialect.ts`). Four are the deployment-mode question D9 renames (`backend/src/data-backend.ts`, `dev-server/server.ts`, `dev-server/relational-health.ts`, `auth-service/src/config.ts`). Three read it as an adapter capability and become a descriptor read (`search-index-worker/src/sqlite-outbox-drain.ts`, `search-index-worker/src/services.ts`, `account-worker/src/config.ts`). Two keep reading a deployment variable because they choose something other than an adapter — which migration sets to apply (`packages/migrate/src/run-migrate.ts`) and which vector store to open (`search-service/src/from-env.ts`).
- 35 test files in `drizzle-service` move to the new adapter or are deleted with the Postgres path; 4 test files elsewhere change with their subject.

Around 90 files are touched. 42 change a signature, which matches the issue's estimate.

## FAQ

**Does reader lose Postgres?** Reader loses the Postgres adapter from this tree. The generated `@remit/drizzle-pg-schema` keeps being emitted and published, and the adapter itself lives where it is deployed. If an in-tree Postgres adapter is wanted later it is a package that imports `data-ports` and the pg entity package, like any other.

**Why not keep one repository body and parameterize it over the dialect?** Because drizzle gives no cross-dialect base to write it against. `PgDatabase` and `BetterSQLite3Database` are distinct types, `PgTable` and `SQLiteTable` are distinct types, and a shared body needs either the cast that exists today or a hand-written facade over drizzle's query builder — a larger and less honest abstraction than two adapters.

**Isn't `data-service` a bad name when it holds `RemitClient`, which is mostly not data?** It holds the client shape and the registry, and it builds neither storage nor search. The name is the one the issue proposed and the scope is stated in D1.

**How does an out-of-tree adapter know the contract changed?** `@remit/data-ports` is a published package. A new port or a changed signature is a version bump, and the conformance suite for the new port fails against an adapter that has not implemented it.

**What stops an adapter passing conformance and still being wrong?** Nothing, for anything the suite does not assert. That is why S1 is first and why D5 is ordered behind it: the Postgres test files leave only after the behaviour they cover is expressed as suites every adapter runs.

**Can two adapters really run in one process, or is that theoretical?** The registry is a map. The blockers are `SQL_DIALECT` and `active-entities.ts`, both module-load reads, and both are gone after S5. A migration that reads one adapter and writes another is then a script with two `getRepositories` calls.

**Why does `AUTH_MODE` belong in a data-backend refactor?** It does not belong to it conceptually, which is the point. Those predicates ask a deployment question through the data backend's variable, and while they do, `DATA_BACKEND` stays a process-wide fact and D3 is cosmetic.

**Is the search-semantics difference (C10) a real problem for callers?** Today it is silent: the same query returns different results on Postgres and SQLite and nothing says so. C10 does not remove the difference, it names it and puts it where a caller can read it.
