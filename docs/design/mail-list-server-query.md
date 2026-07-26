# Design: the mail list as a server-side query

Status: proposed
Follows: [`docs/architecture/mail-list-boundary.md`](../architecture/mail-list-boundary.md), epic #315
Scope: the filtered query and the index it needs, the correctness of `thread_message.category`, the cutover, and the list states a filtered mailbox renders.

The architecture doc sets the boundary and decides D1–D8. This document decides how the filtered query is written, how the column it depends on is made correct and delivered, and what the user sees. Decision numbering continues from it: D1–D8 live there, D9 onward here.

This is the second revision. Two independent reviews cut it down. The first version designed a bounded-read contract, honest counts on five surfaces, a cross-account index and a category presentation table. All of that is withdrawn or deferred. What survives is the smallest thing that closes the reported bug and leaves the column it stands on trustworthy.

## What this covers, and what it does not

The audit behind the architecture doc found 31 client-side derivations and judged 16 misplaced. **One of them causes the reported bug.** The other fifteen are real and are tracked as standalone issues, prioritised on their own merits rather than carried by this ticket.

In scope — #304, #320, #321, #322, #309, #306:

- `category` becomes a SQL predicate, with the index that makes it cheap.
- The write path that maintains `thread_message.category` is corrected, its history repaired, and its round-trip finally tested.
- The mailbox list asks the server for the filtered page, and a filtered empty list is distinguishable from an empty mailbox.
- `uncategorized` becomes filterable from the inbox, which D6 requires and no surface currently offers.

Not in scope, tracked separately — #305, #307, #308, #310, #311, #312, #313, #314:

Exact counts and every surface that would render one; the Flagged and brief filters; the brief's sections; the Spam offer's number; the four duplicated predicate tables and the five duplicated category tables. Each is genuine rot. None of it is required to make a filtered inbox return the mail it holds.

One consequence to state plainly rather than discover later: **`SearchResultsHeader` keeps rendering a page length as a result count** (`MessageList.tsx:1364-1366`). #306 does not make that worse — before and after, the number is the length of the loaded pages — and it does not make it better. #307 owns it.

## Corrections to issues in this epic

Three, each verified in the code:

1. **#304 point 3 names the wrong mechanism** for the index. D9.
2. **`thread_message.category` is not correct today**, and no issue covered it. D15, and the reason the column looks healthy is that nothing has ever read it.
3. **#313 names the wrong source** for its number: the rendered figure is `heldOutSpamCount` (`packages/ui/src/components/search-results.tsx:318`), not `spamOfferForResults`, and the copy is `N results from Spam`, not `N in Spam`. That issue is deferred; the correction is recorded on it.

## Amendments to the merged architecture doc

Three of its decisions go stale here. A merged decision record that quietly stops being true is worse than one that says where it was amended.

- **D1's gives-up clause** says the cost is "a schema index on `category` and a migration to add it". That is now what happens, by a mechanism D1 did not know about (D9). Its Prior-art paragraph — "D1 does not need this mechanism" — is right, and more strongly than it argued.
- **D2's refill loop and D3 in full** describe a bounded-read contract for a port that does not exist in this repository. Not implemented. D14 states why and what would have to be true to revisit it.
- **D4's `count` semantics** stand as a decision and are not implemented here. The read-bound fields it leans on are withdrawn.

## Part 1 — the query

### D9 — the index is declared in TypeSpec with `@indexDef`, which is a SQL index and nothing else

Issue #304 point 3 asks for the index "in the drizzle schema with a migration" and rules out `npm-scripts/*-search-index.sql`. The first half is right and the mechanism was missing.

The drizzle schema is not hand-written. `packages/drizzle-service/src/schema/thread-message.ts` re-exports generated entities, emitted from `typespec/lib/models/ThreadMessage.tsp` by `@kattebak/typespec-drizzle-orm-generator`. The obvious move — add an `@index` decorator — is wrong, and not marginally: `@index` is read by `typespec-electrodb-emitter` too, and `ThreadMessage.tsp:47-85` already occupies `lsi1` through `lsi5`. Its own note at `:87-91` closes the door:

> A "byDeletedStatus" LSI6 was removed here (see #516) — it was never provisioned (the table only has lsi1–lsi5) and DynamoDB's 5-LSI hard limit means it can never be added as an LSI.

So a TypeSpec `@index` for `category` could only be a GSI: write amplification on every message write, on a port D2 says answers this predicate with a `FilterExpression` and which does not exist in this tree.

The generator has a decorator for exactly this. `@indexDef` declares a **SQL index only** — it belongs to the drizzle generator, is held in its own state key, and the electrodb emitter never sees it. Verified present in the pinned build (`@kattebak/typespec-drizzle-orm-generator@3.8.3`: `tsp/main.tsp:20`, `dist/decorators.js:41`, through `dist/ir/builder.js:141` to `dist/generators/index-generator.js`), with two examples in its README. Nothing in this repo uses it yet.

**I1**, on `ThreadMessage`:

```tsp
@indexDef("tm_by_mailbox_category_date",
  [ThreadMessage.accountConfigId, ThreadMessage.mailboxId,
   ThreadMessage.category, ThreadMessage.isDeleted, ThreadMessage.sentDate])
```

`isDeleted` sits before `sentDate` because every read in `packages/backend/src/handlers/thread.ts` hardcodes `excludeDeleted: true` (`:72`, `:89`, `:239`, `:264`) and no caller can turn it off. It is an equality, so it does not break the range, and including it lets a filtered count be answered from the index alone.

Buys: TypeSpec stays the single source of truth, the index arrives through a generated migration, and it is present in every harness that derives its schema from the generated tables — which is what makes the guard below real on both dialects. Gives up: a decorator with no precedent in this repo, so its emitted output has to be inspected once rather than assumed.

**Verification, before anything depends on it.** Run `npm run codegen` and confirm three things: the sqlite and pg drizzle schemas both emit the index, a migration is generated into `deploy/vps/migrations-sqlite/entities`, and the electrodb output is **byte-identical** — no new GSI. If the third fails, `@indexDef` is not the isolated decorator it appears to be, and the fallback is `npm-scripts/{sqlite,pg}-search-index.sql`, where objects the schema cannot express already live (the FTS5 table, the trigram GIN indexes, each for a reason its own header gives). That fallback is weaker — invisible to `vps-migrations-drift.sqlite.test.ts`, applied by the sqlite test harness only under an opt-in flag with one call site (`packages/drizzle-service/src/test-db-sqlite.ts:60-66`) and never by the pg unit harness at all — so it is a fallback, not a preference.

**The guard.** A test asserting the planner uses the index, on both dialects: `EXPLAIN QUERY PLAN` on SQLite, `EXPLAIN` on Postgres, each asserting the index name appears for the filtered window and the filtered count. There are **zero** `EXPLAIN` assertions in the repo today, so this is a new kind of test and #304 says so. The SQLite reasoning needs no `ANALYZE`: I1 offers four equality columns against `thread_message_by_mailbox_id`'s two. The Postgres assertion runs in the `RUN_INTEG_TESTS` lane, the only place a real Postgres exists.

Failure case: the index is absent or ignored and a rare-category page silently costs a mailbox scan. Without the guard nothing fails, which is why the guard is specified before the index is used.

**Upgrade cost.** Building I1 on an existing table is one full index build during the migrate one-shot, with every app service gated behind it (`docker-compose.sqlite.yml:117, 209, 225, 241, 261, 296`). It runs in the generated migration, before the FTS transaction at `run-migrate.ts:168-186`, not inside it. On 14,187 rows it is not noticeable; on a 500,000-row corpus it is seconds, alongside D16's repair scan. Both are logged rather than estimated (D17).

### D10 — the query is the existing keyset window with one more equality

`buildSearchConditions` (`packages/drizzle-service/src/repos/thread-message.ts:139-164`) gains one clause, `category IN (:categories)`, when `search.category` is non-empty. `SearchOptions` (`packages/data-ports/src/types.ts:458-465`) gains `category?: MessageCategory[]`. Ordering, the `sent_date` + `thread_message_id` tiebreak and `sentDateCursorCond` are untouched.

**Read cost, against the real instance** — INBOX holds 14,187 non-deleted thread messages: 4,753 `personal`, 88 `social`. Page size is 50.

| | one page of `personal` | one page of `social` | all 88 `social` | exact `social` count |
|---|---|---|---|---|
| today, browser filter | 3 pages, 150 rows + 3 enrichment batches | 162 pages, 8,060 rows + 162 batches | 284 pages, 14,187 rows + 284 batches | not available |
| SQL predicate, no index | ~150 index entries + 150 row reads | ~8,060 | 14,187 | 14,187 row reads |
| SQL predicate, I1 | 50 index entries, 50 row reads | 50, 50 | 88, 88 | 88 index entries, no row reads |

I1 covers every column in the predicate, so the count column of that table is index-only. The middle row is why the index ships with the predicate rather than after it: a correct filter without an index turns a rare category into a mailbox scan.

Buys: a filtered page costs the same for a common category and a rare one. Gives up: a residual sort inside each tie group on both engines, and one more clause in a predicate builder four read paths share.

**The mixed ordering.** `sent_date <order>, thread_message_id ASC` cannot be a pure index seek. I1 satisfies the leading term and both engines sort only within a tie group — SQLite block sort, Postgres incremental sort — where a tie group is the messages sharing one `sent_date` in one mailbox and category, so one to three rows. **Do not align the tiebreak with the order direction to remove that sort**: it changes which row follows a cursor inside a tie group, so a user mid-pagination across the upgrade sees a duplicate or a skip.

**Known edge: `category` plus an off-row criterion.** `category` leaves `OffRowCriteria`, but `senderTrust` and `dkimMismatch` stay, so a request carrying `category` **and** one of those still takes the off-row branch (`packages/backend/src/handlers/thread.ts:184-199`). The category predicate is applied in SQL either way — it is in `search` now — so the window is category-filtered before enrichment, which is strictly better than today. What survives is D7's known cost: the off-row filter runs over that window, so the page can come back short with a continuation token. Not reachable from the inbox chips, which offer no off-row filter, but one chip away. The named guard is a handler test asserting that with `category` **and** `senderTrust` set, `category` reaches `search` and not `offRow`, so a later refactor cannot quietly send it back.

Failure case: `category` is added to `buildSearchConditions` but the handler keeps routing it to `offRow`, leaving the SQL clause dead and the filter still running over a window. Same guard.

### D11 — `category` on the response comes from the row, and stops being optional

`THREAD_LIST_ATTRIBUTES` (`thread.ts:35-53`) does not list `category` and `toResponse` (`enrichThreadRows.ts:29-48`) does not map it, so `enrichThreadRows` batch-fetches the `message` table for a value already on the row it just read. Note `options.attributes` is accepted and **ignored** by the drizzle repo — every read is `select()` — so updating the projection list alone changes nothing; add it for the DynamoDB port, but the change that matters is mapping `category` in `toResponse` and deleting `categoryByMessageId` (`enrichThreadRows.ts:122-127`). The `message` batch-fetch stays for `authenticity` and `autoMoved`.

After this, the served `category` and the filtered `category` are the same value from the same row. Filter and badge cannot disagree.

`ThreadMessageResponse.category` becomes required. The column is `NOT NULL DEFAULT 'uncategorized'`, so the server can always supply it, and the field's current `@doc` instructs the opposite of settled behaviour:

> Absent for messages synced before classification rolled out — clients should treat this as `personal`.

That is the collapse #45 closed and `packages/web-client/src/lib/display-category.ts` deliberately contradicts, sitting in the contract as an instruction. Two more places say the stale thing and are corrected with it: the **model** doc at `ThreadMessage.tsp:196` ("`category` and `senderTrust` are attached at read time via batch-fetch" — only `senderTrust` will be), and the `category` query-param doc at `typespec/main.tsp:463`, which documents the defect as intended.

`toDisplayCategory` loses its `| undefined` parameter and its `undefined` branch. Leaving a dead branch behind a required field is how the next reader concludes the field is optional.

Buys: one source for the value, and the #45 instruction deleted from the contract rather than contradicted in a comment. Gives up: an optional-to-required change on a response field, and a signature change on `toDisplayCategory` that touches its callers.

### D12 — the cross-account index is deferred, and the claim made for it was wrong

I2, `(account_config_id, category, is_deleted, sent_date)`, belonged with #308 and #312. Both are deferred, and the cost claim attached to it does not hold — recorded here so whoever picks them up does not inherit it.

Every `listAllThreads` mode is scoped by `mailbox_id IN (...)` (`packages/backend/src/handlers/unified-threads.ts:374-405`), and I2 deliberately left `mailbox_id` out so `sent_date` stayed the ordered trailing column. That makes `mailbox_id` a residual filter, so **a count over I2 is not index-only** — every candidate entry needs its row fetched to test the mailbox. Across seven brief sections that is every row in the brief's scope: roughly 14,187 row reads per brief load against 250 today. The earlier version of this document called that "fewer rows read than today". It is a read increase of about fifty-six times.

Whoever takes #312 has to either scope the count so it can be answered from an index, or cost seven counts honestly and justify them. I1's equivalent claim is unaffected: I1 covers every column in its predicate.

Buys: the largest table gains one index rather than two, and a wrong cost estimate is corrected before anyone builds on it. Gives up: the cross-account filtered list stays unindexed, so #308 and #312 start from an unanswered cost question rather than a designed index.

## Part 2 — the numbers

### D13 — `count` is exact and free on the SQL port, and is not built here

Recorded because it is settled and cheap; deferred because nothing in the trimmed scope renders a number.

`countByMailbox` (`packages/drizzle-service/src/repos/thread-message.ts:899-912`) already runs the full `COUNT(*)` and then discards the answer with `Math.min(count, cap)` at `:912`. It also already omits the cursor condition, so the number is the whole match set and does not shrink as the user pages. Dropping the clamp removes a line and costs nothing: the scan already happens. Both properties are accidents today and become contract in #305.

When #305 is picked up, `count` stays opt-in and these are requirements, not advice: its own query keyed on the criteria **without** the cursor, so a page fetch can never trigger it; `staleTime` of 60 seconds; requested immediately for chip-driven criteria; and **never for a free-text query under three characters**, because `npm-scripts/sqlite-search-index.sql` documents that sub-three-character queries fall back to an unindexed folded `LIKE` scan, and a count over a predicate the index cannot serve is a mailbox scan per character.

`count` is already `count?: int32` on `ThreadSearchResponse`. An absent count therefore needs no new field and no new surface, which is what makes the "no new API surface" claim true rather than nearly true.

Buys: the epic ships without touching the API, and the count's cheapness is recorded while it is fresh rather than rediscovered. Gives up: a number that is free on the SQL port stays unused, and five surfaces keep showing page lengths until #305 and #307 are scheduled.

### D14 — withdrawn: the bounded-read contract is documented, not built

The first version of this document added `rowsRead` and `readLimit` to `ThreadSearchResponse` and a three-state client helper to resolve them. All of it is withdrawn. Both reviews reached that independently, from different directions.

It was unnecessary. Its only purpose was to let a port that bounds its reads say so, and there is no such port here: `DrizzleThreadMessageRepository` is the only implementation of `IThreadMessageRepository`, the DynamoDB composition is injected through `setClient()` with no in-tree caller, and the SQL port's reads are unbounded. A contract with no second party is one nobody can be wrong about.

It was also incorrect. `readLimit` on the off-row path is the request `limit`, not a fixed 500 — and #306 mandates `limit: 50` — so the copy it was designed to produce, "only the newest 500 messages were checked", was wrong for every caller except `useRescueCandidates`. The value it carried was one page's post-filter length, so a header derived from it would render a page length as a total, go *down* as the user paged, and vanish on the last page when the window stopped filling. That is the shape the same document forbade one section later.

What replaces it: nothing. The SQL port answers over the whole match set, so `count` is a number when requested and absent when not derivable. The port divergence stays documented — in the merged D3, and here — as the thing to design **when a second port lands**, with one note attached: the honest unit is the criteria evaluation, not the page. The first version got that distinction right and the values wrong.

Buys: three fields, one helper, one new response model on `listAllThreads` and a false empty-state sentence all disappear; "no new API surface" becomes literally true. Gives up: when a bounded port arrives this has to be designed then, against a real caller, instead of now against an imagined one.

## Part 3 — the column the predicate depends on

### D15 — the denormalized column is not correct today

The architecture doc states that `thread_message.category` is written by body-sync as the copy the read path serves, and measured that on the live instance's INBOX it agrees with `message.category` on every row. Both are true. Neither makes the column trustworthy: the read path has never used it — `enrichThreadRows` goes to the `message` table — so nothing has ever depended on its write path being complete. Four defects survive, all verified.

1. **Inverted write order in the retro path.** `backfillClassification` (`packages/mailbox-service/src/body-sync.ts:929`) writes `Message` at `:944` and `ThreadMessage` at `:945`, while its skip guard at `:932-938` keys off `message.category`. A throw between them leaves `message.category` decided and `thread_message.category` stranded at `uncategorized` permanently: the caller captures the error at `:319`, requeues, and the retry hits a satisfied guard. The live path has the opposite order and says why — ThreadMessage at `:652`, Message last at `:787`, "Written LAST so bodyStorageKey — the skip-guard signal — is only durable once the parsed cache AND the move (when any) are."
2. **One arbitrary row per message.** `denormalizeCategory` (`:1485`) resolves its row through `getByMessageId` → `findByMessageId` (`packages/drizzle-service/src/repos/thread-message.ts:666-681`), a `.limit(1)` with no `orderBy`. A message in two mailboxes has two rows; one gets the category, the other keeps `uncategorized`, and which one is planner-dependent. `flag-queue.ts:121` and `:182` iterate `findAllByMessageId` for exactly this reason.
3. **A row created after classification never gets the value.** `createThreadForMessage` (`packages/mailbox-service/src/message-sync.ts:1404`) creates without a category. Correct for a new unclassified message; wrong when metadata sync finds an already-classified message in a second mailbox, because `denormalizeCategory` will not run again.
4. **No test asserts the column round-trips.** The integration DDL at `packages/drizzle-service/src/repos/thread-message.test.ts:31-63` is `CREATE TABLE IF NOT EXISTS` and omits both `category` and `list_id`. `packages/data-ports/src/conformance/` is three files covering labels only.

Adjacent and deliberately not fixed: `create()` is `onConflictDoNothing` over a deterministic `threadMessageId` (`thread-message.ts:245-257`), so re-creating an existing row discards a supplied `category` and returns the existing row. A replayed sync repairs nothing. Repair is D16's business; making `create` upsert would change insert semantics for every field to fix one. #322 pins the current behaviour so a later change to upsert cannot pass silently.

Buys: the column becomes as correct going forward as the value it copies. Gives up: three write-path changes in a package this epic did not otherwise touch.

### D16 — the repair runs inside `migrate.mjs`, because that is the only artefact that reaches an instance

The repair is one idempotent statement, run only when the check that precedes it found something to write — the value is a join away in the same database, so none of PR #292's checkpointing, batching or resumability applies:

```sql
UPDATE thread_message SET category = (
	SELECT m.category FROM message m WHERE m.message_id = thread_message.message_id
)
WHERE EXISTS (
	SELECT 1 FROM message m
	WHERE m.message_id = thread_message.message_id
	  AND m.category <> thread_message.category
	  AND m.category <> 'uncategorized'
)
  AND thread_message.updated_at <= <the statement's start, in ms>;
```

`message.message_id` is the primary key and `message.category` is `NOT NULL`, so the scalar subquery is single-valued by construction, the `<>` never sees a NULL, and a not-yet-classified row correctly writes nothing. Re-running finishes an interrupted run; afterwards the `WHERE` matches nothing.

That is a correctness argument, not a plan. Measured on 200,000 rows, Postgres answers it as a hash join over two sequential scans with an 8.5 MB temp spill rather than a per-row primary-key probe — 2.7 s, `dirtied=45` pages for 2,000 repaired rows, so only diverging rows are written. SQLite: 400 ms with 2,000 divergent, 219 ms with none.

**Two predicates were added when this was built (#321), both so the repair can never leave a row worse than it found it.** The clock is `unixepoch('subsec') * 1000` on SQLite and `EXTRACT(EPOCH FROM now()) * 1000` on Postgres; both are fixed for the duration of the statement, so no parameter is bound and the statement stays one string per dialect.

- `m.category <> 'uncategorized'`. Without it the statement copies the pending state over a classified row whenever `message` is pending and `thread_message` is not — the one direction the original did not consider. `uncategorized` is a declared pending state, not absence (#45). #326 orders body-sync's writes row-first, message-second, so a classification in flight legitimately puts the row *ahead* of its message for a moment; pushing it back would undo a correct classification and make the read path D11 builds serve `Unclassified` for mail that is already classified. This answers the question #326 leaves for this slice: the row is not converged, it is left alone and counted as `ahead`, which is a figure a live instance is expected to carry.
- `thread_message.updated_at <= <statement start>`. See the mid-sync paragraph below.

**Where it runs is the part the first version got wrong.** It proposed a second entrypoint invoked by the compose one-shot. That cannot reach an existing instance. `remit` fetches nothing — the compose file is only ever read from `$REMIT_DIR` on disk (`deploy/vps/remit:149-156`), `update` moves an image tag and runs `compose pull` (`:1608-1653`), and the repository-root `install.sh:25-49` is the only thing that ever downloads `docker-compose.sqlite.yml`. Open issue **#281** states the general case: *"Self-update delivers images only — compose and env changes never reach instances … any release whose fix lives in compose/env/wrapper cannot ship through the UI update."* So the first version's mechanism was #292's manual command with extra steps, wearing the argument against itself.

The repair therefore runs as a step **inside the existing migrate entrypoint**. The on-disk compose file already pins `image: ghcr.io/…/backend:${REMIT_TAG}` with `command: ["node", "migrate.mjs"]` (`docker-compose.sqlite.yml:70-85`), `remit update` pulls a new backend image for that tag, six services gate on the one-shot completing, and `check_migrate()` (`remit:236-250`) enforces it again. A new step in that file reaches every installed instance with no host-side action.

That amends `run-migrate.ts`'s header, which currently says it "does not rewrite row content". The amendment is explicit, in the file, with the reason: a data repair the filter's correctness depends on has to arrive with the image, and this is the only path that does. A doc comment does not outrank the repair running. The alternative — depend on #281 landing first — buys the comment and blocks the bug fix behind an unstarted design, of which #278's staging redesign is the other half.

Orchestration stays where it belongs: `remit update` already invokes the migrate step and already gates on it, so the wrapper's own tests cover that an update runs the repair. Nothing is added to the wrapper.

**An instance mid-sync.** `remit update` stops every service before it starts the gate set (`remit:1655-1656`), so the repair normally runs with no concurrent writer at all. The quiet window is not assumed, because `compose up -d` without a stop re-runs the completed one-shot while unchanged app containers keep running, and the row a writer touches is then the row the statement is writing.

`thread_message.updated_at <= <statement start>` is what makes that safe (#321). On SQLite writers are serialized, so a concurrent body-sync write lands wholly before or wholly after the statement and both orders converge — the guard is redundant there and costs nothing. On Postgres it is load-bearing: under READ COMMITTED an UPDATE that meets a row a concurrent transaction just committed re-evaluates its `WHERE` clause against the new version of that row, but still reads other tables at its original snapshot, so without the guard it can write a pre-classification `message.category` over the value the writer just wrote. The guard makes that row fail the re-check and the writer's value stands. All three interleavings are driven with two real connections in `packages/drizzle-service/src/repair/thread-message-category.test.ts`, and removing the guard fails the covered one.

What the guard covers is a writer whose transaction *begins after* the statement. A writer that began before it carries an older stamp and passes — and being explicit about the boundary: reaching that requires all three of an unrepaired `behind` row, a writer overlapping the statement, and that writer moving `message.category` from one decided value to another. Nothing does the third. `backfillClassification` returns early once the category is decided, so a message is classified exactly once, `uncategorized` to a value, and the concurrent case that actually occurs — body-sync filling in the copy of a category the message already holds — makes the row *agree* on the re-check and is written by neither party. The window is therefore unreachable on today's write paths rather than merely rare; it opens the day re-classification is added, and `crossed` is the figure that would report it.

A residual is not silent, and it is not promised a quick end. The next run of the repair is the next start of the migrate one-shot, which on a self-host instance means the next `remit update` — weeks, not minutes — so the residual is reported split by cause: rows a writer touched during the statement, whose value is correct and merely unchecked, and rows whose `updated_at` is ahead of the database clock, which fail the guard on *every* run until the stamp is corrected. A clock that jumped before NTP settled, or a restored backup, produces the second; conflating the two would promise a self-healing that never comes.

A row whose message has no body yet has nothing to copy and stays `uncategorized`, correctly — body-sync will fill it, and after #326 it will fill every row for that message.

**The write only happens when there is something to write.** SQLite takes its exclusive write lock when an `UPDATE` begins, before it can know the `WHERE` matches nothing — measured: with zero divergence and another connection holding the lock, the statement raises `SQLITE_BUSY`. Since the steady state after the first run *is* zero, an unconditional statement would contend for that lock on every boot forever, and a lock it cannot acquire within the migrator's `busy_timeout = 5000` fails the migration and holds all six gated services down. The check that precedes the repair already produces the number, so the repair is skipped when it is zero. Reads take no write lock, so the check itself is safe against a live writer.

Buys: the filter cannot go live against a stale column on any instance, by any upgrade path, and a healthy instance's boot costs two aggregate reads and no lock. Gives up: a stated invariant in `run-migrate.ts` is amended rather than preserved, and every update pays those reads.

Failure case: the repair is added to the compose file instead of the image, and an operator who runs `remit update` gets the new client, the new server and no repair. The guard is that #321 touches no compose file.

### D17 — the repair reports what it did, on real data

The same entrypoint takes `--check`, writes nothing, and reports: rows where `thread_message.category <> message.category`, total and per mailbox; rows whose `message` row is missing; rows still `uncategorized` **whose message is also `uncategorized`**, reported separately so the not-yet-classified cohort cannot be mistaken for a failed repair; and the per-category tally. It runs on every update alongside the repair and logs its numbers, so an upgrade leaves evidence.

The runtime is logged, not estimated. Earlier drafts asserted "milliseconds" and "seconds"; those were guesses, and the log makes them measurements.

**The prediction of non-zero divergence in Archive and label folders was wrong, and the correct answer is zero.** `deriveMessageId` and `deriveThreadMessageId` are both mailbox-independent, so a message in INBOX and Archive collapses to one `thread_message` row via `onConflictDoNothing` and `applyChange` never reaches `saveMessage` (`packages/mailbox-service/src/message-move.ts:709-717`). The multi-row fan-out D15's defects 2 and 3 describe is schema-legal but not normally produced, which is why #326 keeps it as hardening. So most of what `--check` reports is legitimately zero, and a bare `0` cannot be told apart from a repair that never ran.

`--check` therefore reports each figure with the cause it measures and the result a healthy instance is expected to produce (#321), and the causes are split by *direction*, because the direction is the cause:

1. **`behind`** — the row is pending, its message is classified: the copy of a decided category never landed. All three of the write-path defects #326 fixes end here, and only here. This is the cohort the repair exists for. Expected non-zero on an instance where any of them fired.
2. **`crossed`** — both classified, differently. No current write path produces it, because `message.category` moves from pending to a decided value exactly once. Repaired. Expected zero; a non-zero means a classification changed without its copy following.
3. **`ahead`** — the row is classified, its message is pending. After #326 that is a classification in flight. Not repaired. Expected **non-zero on a live instance mid-sync**, zero on a quiescent one.
4. **`fan-out`**, **`orphans`** — expected zero, each for a stated structural reason.
5. **`not-yet-classified`** — expected non-zero on a live instance, and untouched by the repair.

**An earlier revision of this document, and of #321, gave `behind` the wrong cohort**: mail classified before 2026-07-08 plus a Postgres instance whose column arrived by `drizzle push` with its default. Neither can occur on the deployment this ships to. `ThreadMessage.category` landed 2026-07-08; the SQLite backend and its baseline migration both landed 2026-07-18 with `category text DEFAULT 'uncategorized' NOT NULL` already inside `CREATE TABLE`, so no SQLite instance ever saw an `ADD COLUMN … DEFAULT` and none has a corpus predating the column. `requirePostgresMigrations()` makes Postgres self-host unsupported in this build, so the stamped-by-push cohort is a deployment this repair never meets. A cause an operator can rule out by inspection is worse than no cause at all: it reads as a broken figure, which is the misreading this decision exists to prevent, pointing the other way.

After the repair it re-reads only the residual, so "nothing to do" is distinguishable from "did not run" — a repair that never ran logs no repair line at all.

**Measured on the owner's instance, read-only, 2026-07-26.** 17,795 `thread_message` rows across seven mailboxes (14,187 in INBOX): zero divergence in every bucket, zero orphans, zero fan-out, and no `uncategorized` rows at all — `newsletter=5197 personal=5192 marketing=4111 automated=2759 transactional=440 social=96`, matching `message` exactly.

**What explains that zero is that none of #326's three defects has fired on this corpus.** Post-dating the column is necessary and not sufficient: the paths that denormalize are exactly the three that are still defective on `main`, so a row written after 2026-07-08 is not therefore a correct row. Each defect needs an uncommon trigger — a failure between two writes, thread-root drift producing a second row for one message, or a row created for a message that was already classified — and none of them has occurred here.

So the repair is a **no-op on this instance**, and that is the right result. The install it is for is one where a defect did fire, which is the whole live cohort of the SQLite self-host product: the `ADD COLUMN … DEFAULT` cohort is a Postgres story and Postgres self-host is unsupported in this build. That is a good reason to ship it, and a different one from the reason first written down.

Buys: the repair's effect is a recorded number on a real corpus rather than a claim, and each zero is attributable. Gives up: a second read pass on every update.

## Part 4 — the cutover

### D18 — every deploy skew degrades to today's behaviour; the repair is the only gate

The client-side predicate is idempotent over a server-filtered set — `applyInboxFilters` is a pure predicate over `t.category`, so filtering twice yields what filtering once yields.

| | old server | new server |
|---|---|---|
| **old client** | today | today; the client sends no `category` |
| **new client** | server ignores `category`, the local filter still applies: today's behaviour | fixed |

A new client against an old server is the current bug, not a broken list. So `applyInboxFilters` is deleted in the same change that starts sending `category`: no flag, no dual-path period.

Order: #304, #320 and #322 are additive and can land in any sequence; #321 must precede #306; #309 must precede #306, which renders states #309 defines.

Two client-side hazards this creates, neither of which existed while the filter was local:

**The previous predicate's rows must never render under the new filter.** The list re-keys on the filter, and `placeholderData: keepPreviousData` (`MailboxPane.tsx:337`) then renders the old predicate's rows while the new page is in flight — a visibly wrong list for one round trip. On a filter change the list renders the transition state (S4), not stale rows. Pagination *within* one filter keeps `keepPreviousData`. `listState` (`MessageList.tsx:1090-1097`) must not resolve to `empty` while a fetch for the current criteria is in flight.

**The open thread must survive a filter change.** `resolveSelectedThread(rawThreads, …)` (`MailboxPane.tsx:406-411`) resolves the reading pane against the unfiltered set, with the comment saying it does so "so a filter never closes the reading pane". After the cutover there is no unfiltered set in the client. Snapshot the selected row into state on selection and resolve the pane from that snapshot before falling back to the list — a derivation over what the user selected, which the boundary keeps client-side.

Buys: no flag, no dual-path period, and a partially-updated stack degrades to the bug it replaces. Gives up: one hard ordering constraint, and two hazards that have to be designed out rather than discovered.

Failure case: #306 lands before #321 on an instance whose column diverges, and the list under-returns old mail with nothing masking it. The guard is the dependency, and the `--check` numbers recorded before #306 ships.

## Part 5 — the states a filtered list renders

### D19 — a filtered empty list states that the whole folder was checked

An empty list looks the same whether it is correct or broken, which is how this bug survived. So the filtered empty state says how much was read.

There is one thing it can say, and the query is what makes it true: the predicate is a SQL `where` over the mailbox, unbounded, so a filtered empty result means the folder holds no matching mail. No number is needed to assert that, and none is available in this scope (D13).

**S1 — unfiltered, empty mailbox.** Unchanged: `No messages in this mailbox`.

**S2 — filtered, no matches.**
> **No Personal mail in Inbox**
> Every message in this folder was checked.
> `Clear filter`

With a search query as well: headline `No results for “invoice” in Personal`, same body.

**S3 — withdrawn.** The earlier bounded variant ("only the newest 500 messages were checked") named a number the code does not produce and made a completeness claim that was false where it was reachable — the off-row branch returns a continuation token, so older mail is reachable by paging. A category filter can never reach it: `category` is on-row, `hasOffRowCriteria` is false, the branch is not taken. Where it *is* reachable — `category` plus `senderTrust` or `dkimMismatch`, per D10 — the honest statement is that the page was bounded and there is more to check, and that belongs with whoever moves those criteria on-row (D7). The inbox chips offer no off-row filter, so nothing in this epic renders it.

**S4 — filter changed, pagination restarted.** The loading skeleton. Never the previous predicate's rows, never an empty state.

**S5 — filtered, with results.** Rows. The filter's identity is already visible in the collapsed chip summary (`packages/ui/src/components/filter-sheet.tsx:155-180`), so no new header is introduced — and the existing `SearchResultsHeader` count stays as wrong as it is today, owned by #307.

**S6 — filtered, fetching a further page.** Rows plus `Loading more…`. Today it is a bare spinner (`MessageList.tsx:1429-1433`), which is one of the ways "not fetched yet" reads as "nothing there".

**S7 — error.** Unchanged: `Couldn't load messages` / `Retry` / `Report a problem`.

Buys: the state that hid this bug becomes self-describing, and a future filter returning nothing cannot hide behind an ambiguous screen. Gives up: more copy in an empty state than one usually carries, and a completeness claim the query now has to keep true.

Failure case: a surface renders the plain empty state under an active filter because the filter is not among the component's props. The guard is a test that the filtered-empty and unfiltered-empty states render distinguishably.

### D20 — the trimmed scope renders no number, and says so

No count request, no result-header change, no footer total. `Showing 50 of 4,753` was the best cure for this class of bug and it needs an exact count, so it goes to #305 and #307 with the rest.

What that costs, stated rather than hidden: after #306 a user with an active filter sees a correct list and, if they are also searching, a header whose number is still the count of loaded pages. The filtered-empty case — the reported bug — is fully addressed, because S2 needs no number. The partially-loaded case is not improved.

Buys: the epic ships without a count on any seam, and the "no new API surface" claim holds literally. Gives up: the honest-number work that motivated half the audit is deferred, and one wrong number stays on screen in the search case.

### D21 — `uncategorized` becomes filterable now; the rest of the category cleanup is deferred

D6 requires `uncategorized` to be filterable, and `MESSAGE_CATEGORIES` (`packages/ui/src/filter-presets.ts:35-43`) has no entry for it, so the inbox cannot ask for unclassified mail at all. Shipping #306 without that would give the inbox a correct server-side category filter and no way to reach one of its categories.

In scope: the chip. `{ id: "uncategorized", label: "Unclassified" }`, placed after `Personal` to match `briefCategories`' order, landing in #309 with its story before #306 wires it.

Deferred to #314: collapsing the five category tables (`MESSAGE_CATEGORIES`, `categoryTone`, `briefCategories`, `CATEGORY_LABELS`, `CATEGORY_SECTIONS`) plus the two hand-rolled category unions in the kit (`app-shell-types.ts:163`, `category-badge.tsx:3`, whose own comment says the generated enum is not importable from the UI build — so collapsing "keyed by `MessageCategory`" is blocked on that, not free). Also deferred: `message-row.tsx:164` rendering the raw enum where `CategoryBadge` renders a title, and the copy decisions bundled with it — `notification` versus `Automated`, `receipt` versus `Transactional`, `marketing`'s tone moving from `warning` to `neutral`. Those are user-visible copy choices, not drift-collapsing, and each needs a decision and a story rather than a rename. **#314 gets a story issue in front of it before any of it lands.**

The one guard that ships now: a test asserting a row whose category is `uncategorized` renders neither the personal presentation nor nothing at all. That is the mechanical check #45 never had — both `display-category.ts` and `category-badge.tsx` hold the line by comment only.

Buys: D6 is satisfied in the same release that makes the filter work. Gives up: the inbox chip row and the brief chip row keep two spellings of the same list until #314.

### D22 and D24 — withdrawn with the slices they described

Both numbers were cited on issues before this revision, so they resolve here rather than dangling.

**D22** designed the brief as section-paginated with per-section server counts. Its pagination answer survives — the brief paginates by section, not as a page, and `Show N more` fetches — and is recorded on #312, which must still answer #197. Its read-cost claim did not survive: see D12.

**D24** moved the selection count, the delete confirmation and the Spam offer onto exact counts. Its copy decisions survive on #307 and #313: `Counting…` with no number, the `≥ 5000` "big result set" variant deleted, `about` dropped from the delete title while the snapshot sentence stays, and the Spam offer rendering no number rather than a page share.

### D23 — the states land in Storybook first

Per D8, #309 lands before #306 and #306 consumes what it defines. In scope: `message-list-state.tsx`, which has a render test and **no story file** today and which renders the empty state this epic is about; the `Loading more…` affordance, which joins it there rather than staying inline in a 1450-line web-client file; and the `uncategorized` chip on `filter-sheet.tsx`'s existing stories.

`message-list-state.tsx` also needs a scope label from its caller, because `FlaggedList` renders `No messages in this mailbox` for a cross-account collection that is not a mailbox. Only the parameter lands here; Flagged's own states are #310.

Render tests follow the existing convention exactly — `.render.test.ts`, never `.tsx`, since the `packages/ui` glob is `src/**/*.test.ts` and a `.tsx` test silently never runs. `node:test` plus `renderToString`, state through `initial*` props, assertions on literal copy. Coverage gate is 90% lines.

Asserted rather than reviewed by eye: S2 against S1 (filtered-empty versus empty mailbox), S2 against S4 (empty versus fetching), and the `uncategorized` guard above.

Buys: the component that renders this epic's symptom finally has a story, reviewable next to the correct-empty case. Gives up: one hop before #306 can start.

## FAQ

**Why not filter by joining to `message.category` and skip the denormalized column?** The join has to happen before the limit, so the planner would probe `message` for every candidate in the mailbox — 8,060 probes for one page of `social`, 14,187 to exhaust it. The on-row predicate exists so the engine can seek.

**Why is the epic so much smaller than the audit?** One derivation causes the reported bug and fifteen are debt. The debt is filed, not forgotten. Shipping the fix does not require shipping the migration.

**If the live instance's INBOX already agrees on every row, why repair anything?** Because the instance that agrees is not the instance the repair is for. Nothing has ever read the column, so nothing has ever depended on its write path, and the rows at risk are the ones a #326 defect touched: a classification stranded between its two writes, a denormalize that wrote one of several rows for a message, or a row created for a message that was already classified. Each needs an uncommon trigger, none has fired on the owner's corpus, and every one of them is silent until #328 makes the column the predicate. `--check` reports the real number, per cause, before anything is written.

**Why is this repair automatic when the `listId` backfill is manual?** Forward-only matching was an accepted outcome for `listId` (#263 says so). Skipping this one means the filter goes live against a stale column and the reported bug persists with nothing masking it.

**Why amend `run-migrate.ts`'s "never rewrites row content" instead of respecting it?** Because a compose-level step does not reach an installed instance (#281) and the image does. The invariant was worth stating and is worth amending in the open, with the reason in the file.

**Why `@indexDef` rather than the `.sql` files?** All five LSI slots are used and `ThreadMessage.tsp` says a sixth can never be added, so a TypeSpec `@index` could only be a GSI. `@indexDef` is the drizzle generator's SQL-only decorator, so the index reaches the schema, a migration and both test harnesses without touching the DynamoDB entity. The `.sql` files remain the home for objects the schema cannot express, which a five-column b-tree is not.

**Why does an exact count not ship with the filter, when the doc says it is free?** It is free on the SQL port and it is not needed to close the bug — S2 asserts completeness from the query, not from a number. Counts touch five surfaces and each needs its own honest treatment; that is #305 and #307.

**What happened to `rowsRead` and `readLimit`?** Withdrawn. They existed to let a bounded port report its bound, there is no such port in this repository, and the values they carried would have rendered a page length as a total. D14 has the detail.

**Do the filters survive a reload?** No. `filterCategory` and `filterAttributes` stay local component state; the URL carries `selectedMessageId`, `selectedThreadId` and `q`. Putting filters in the URL is a real improvement and is not this correction.

**Can a user filter to more than one category at once?** No. The chips are single-select today and stay single-select; the array parameter receives one element.

**What happens to `uncategorized` mail?** It gains the inbox chip it never had, keeps its own label and its own brief section, and gets the test that fails if it ever renders as personal or as nothing.
