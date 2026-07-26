# Folder rename and delete

Applies the IMAP mutation rules (`imap-mutations.md`) to folder rename and folder delete. R1 (record pending, settle on confirmation) and R2 (every dependent chooses wait or reconcile, explicitly) are not re-opened here; this document says what they mean for these two operations and what has to change to satisfy them.

Folder create already follows R1 on the settle side. PR #346 supplied the reconcile half for sync: a job that targets a folder the server does not hold resolves instead of failing, which stopped a folder mutation stalling an account's whole mail sync for a queue visibility window (#339). Rename and delete still violate R1 on the record side — they write server truth locally before the server has confirmed anything.

## What is wrong today

A rename writes the new path onto the row immediately (`mailbox-queue.ts:167`) and `renameChildPaths` rewrites every descendant's path the same way, marking each `pending` (`i4-mailbox.ts:335-351`). The rows now claim paths the server does not hold. When the rename then fails for any reason other than `NONEXISTENT`, the worker restores `fullPath` on the renamed folder and marks it `failed` (`handlers/mailbox-management.ts:269-273`) — and touches no descendant.

What follows is not a reap. The stranded descendants are `pending`, and both the reap loop (`mailbox-sync.ts:239`, from #290) and message sync (#346) skip `pending` rows, so nothing removes them and nothing syncs them. The damage comes from the sweep's other branch:

1. The parent is restored and `failed`. Each descendant is left at its non-existent new path, `pending`.
2. The sweep LISTs the descendant's real path, finds no row keyed to it — `existingByPath` is keyed on `fullPath` (`mailbox-sync.ts:112-115`) and the row sits at the new path — and takes the insert branch (`:215-223`), which has no state guard of any kind. It inserts a **second row with a fresh `mailboxId`** and initial-syncs the folder's mail into it.
3. The original row survives indefinitely: `pending`, so permanently skipped by both message sync and the sweep; at a path that does not exist; still holding every `message` and `thread_message` row, every filter and every role appointment bound to its `mailboxId`.

The outcome is duplicated mail under a second `mailboxId` plus a permanent, invisible phantom folder. Silent, permanent, and self-duplicating on every subsequent rename failure. Worse than the stall #346 fixed, which is why this is ordered ahead of anything else here.

Delete has a separate defect on the settle path. `syncDelete` removes the mailbox row alone (`mailbox-management.ts:243-247`), so the folder's `message` and `thread_message` rows persist forever keyed to a dead `mailboxId` — there are zero foreign keys and no cascade in the schema — and because nothing writes the `message.removed` outbox event, the deleted mail stays in the search index and keeps coming back in results. Separately, the list response hides `deleting` rows (`handlers/mailbox.ts:203`), so a folder whose delete does not settle vanishes from the UI while still existing on the server.

Neither operation is guarded against a second client. `MailboxRepo.update` has no from-state predicate anywhere in the repo layer, so two tabs both issuing a delete both record intent and both enqueue.

## Decisions

### D1. The mailbox row is the durable record, and its state field is total

`syncStatus` becomes required with a default of `synced`, over the values it already has: `synced`, `pending`, `deleting`, `failed`. Rows that currently read back as absent are the ones the sweep inserted from a server LIST — a folder the server just told us about is confirmed — so they backfill to `synced`. `MailboxRepo.create` passes `syncStatus` straight through (`i4-mailbox.ts:83`) and the sweep is its only caller that omits one (`mailbox-sync.ts:411`), so that is the whole population.

The backfill is not optional and is not a nicety: the transitions in D3 are SQL predicates, so a row whose `sync_status` is NULL can never start a mutation at all.

SQLite cannot alter nullability, so drizzle-kit emits a copy-and-swap, and it does not emit data migrations. The backfill therefore lands as its own earlier migration — `drizzle-kit generate --custom`, whose entire purpose is a hand-written statement with a generated journal entry and snapshot — carrying `UPDATE mailbox SET sync_status = 'synced' WHERE sync_status IS NULL;`. The generated schema migration follows it. Drizzle's SQLite migrator runs every pending file in one folder inside a single `BEGIN`/`COMMIT` (`sqlite-core/dialect.cjs:662-695`), so the two are ordered within one transaction and the rebuild's `INSERT … SELECT` sees no NULLs. Nothing generated is hand-edited.

*Buys:* one field answers "is a mutation in flight on this folder", with no fourth case for every reader to remember, and the CAS predicates become total. *Gives up:* a table rebuild on every existing instance, in the migrate one-shot that gates all six services — which is why the backfill is a separate, ordered file rather than an edit to the generated one.

### D2. `fullPath` is always a path the server holds; the rename target lives in `pendingPath`

A rename records the target in a new `pendingPath` field and leaves `fullPath` alone. The settle writes the confirmed path into `fullPath` and clears `pendingPath`. The dead `oldPath` column — never written by any code path, documented as the inverse of what is needed — is dropped.

Because `fullPath` never names a path the server does not hold, nothing that resolves a folder path from the row is exposed to a path that does not exist, and a failed rename needs no unwinding for the folder or its descendants: dropping `pendingPath` is the whole revert. The multi-row restore that today is written for one row and omitted for the rest stops existing.

The confirmed path is the one ImapFlow resolved, not one the server echoed. IMAP's RENAME reply carries no path; `ImapFlow.mailboxRename` returns `{path, newPath}` built client-side by `normalizePath` (`imapflow/lib/commands/rename.js:22-38`) with the namespace prefix applied, special names resolved and the delimiter joined. Adopting it is still right — it fixes namespace-prefix and delimiter drift and is strictly better than the requested string — but it does not detect a server that stores a different name, and D9 forbids treating a later LIST as authoritative. That case is not covered and is not claimed to be.

*Buys:* the revert is a field clear rather than a multi-row restore; no dependent operation can resolve a stale path. *Gives up:* until the rename settles the UI shows the old name with the target labelled, a reader wanting the requested name must read a second field, and the sweep's local↔server join is now blind to a folder the server has already renamed — which D14 has to cover.

### D3. Every transition is a conditional write, and the state field is the lock

`MailboxRepo` gains a transition that sets state only when the row is in an accepted from-state, as one `UPDATE … WHERE … syncStatus IN (…) RETURNING`. No `mailbox_lock` row participates: a second mechanism that can disagree with `syncStatus` is worse than one that is enforced. The predicate being on `syncStatus` rather than on `updatedAt` also means an unrelated metadata write — the sweep persisting fresh counters — cannot make a transition lose.

The lock is enforced rather than remembered: `syncStatus` and `pendingPath` come off `UpdateMailboxInput`, so the transition is the only way to write them and bypassing it is a type error. Two current callers move onto it — the worker's INBOX backstop and the sweep's explicit `synced` insert.

The all-or-nothing subtree check is the UPDATEs' own affected-row count against the resolved row count, with the from-state predicate on each UPDATE. A read-then-write check would be safe on SQLite only because `runInTransaction` serializes every top-level write behind one queue, and would leave the race open on Postgres under READ COMMITTED.

A client that loses the compare-and-set gets **409** with a message naming the intent already in flight — `A delete is already in progress for "Receipts".` Existence is established by the handler's `assertMailboxInAccount` read beforehand, so a lost CAS is a conflict; the one case where the row disappeared in between is classified by a single primary-key read on the conflict path and reported as 404.

*Buys:* correctness with more than one client, from the field the readers already consult, unbypassable by construction. *Gives up:* no queue position or wait time is reported to the loser; it learns the state, not the ETA.

### D4. A refusal that can never succeed is 400, a race is 409, an unready target is 422

400: deleting INBOX, renaming INBOX, renaming a folder to a path that canonicalizes to INBOX or to a reserved leaf name (D5), deleting a folder that has child folders, deleting a folder that durable references are bound to (D16). None become possible by retrying the same request.

409: only a lost compare-and-set on the folder being mutated.

422: a write that binds to a folder whose own mutation has not settled (D12, first row). This is a distinct status rather than a second 409 because `formatResponse` emits `{message}` with no machine-readable code (#371), so status is the only thing a client can branch on — and the two cases need different copy. "Something else is already changing this folder" and "the folder you are pointing at is not ready yet" are different sentences and different remedies.

*Buys:* the client branches on the status alone, which is all it has. *Gives up:* three statuses to keep straight for one resource, and 422 is a choice, not a standard — a reader expecting 409 for both will be surprised once.

### D5. Renaming INBOX is refused, and so is renaming to a reserved leaf name

The server would move INBOX's messages to the new name and leave INBOX behind, empty. That is a bulk move plus a folder that outlives it, not a path update: it strands the account's inbox appointment on the renamed row, and the moved messages get new UIDs under a different `UIDVALIDITY`, voiding the row's cursor.

Renaming *to* a reserved leaf name is refused for a different reason. `isDuplicateSpecialUse` decides on the leaf segment (`mailbox-sync.ts:598-600`) against `FOLDER_NAME_TO_SPECIAL_USE` — `trash`, `bin`, `drafts`, `sent`, `junk`, `spam`, `archive` and their variants. A rename to any of those settles as `synced`, and then the next sweep deletes the row via `mailboxService.delete` — without its mail — whenever another folder holds the corresponding flag. Refusing at the API is the same class of check as the rest of D4 and does not require touching the sweep's heuristic.

A user who wants either outcome moves the mail, which is an operation that already exists.

*Buys:* rename keeps one meaning — a path update, no mail moves — with no exception to carry through the settle, the cursor logic or the role appointments, and no path where a settled rename destroys mail. *Gives up:* two capabilities the server offers, and the reserved-name list is a heuristic, so the refusal inherits its false positives — a user genuinely wanting a folder called `Archive` under a parent is told no. `validateMailboxOperation`'s current test asserting INBOX rename is allowed inverts.

### D6. A subtree rename is one intent recorded over N rows, in one transaction

RENAME renames the whole subtree on the server in one command, so recording the intent must be all-or-nothing. The intent transitions the folder and every descendant in one transaction, each to `pending` with its own rewritten `pendingPath`. If any row in the subtree is not in an accepted from-state, the whole intent is refused with 409 — a subtree cannot be half-renamed, so a descendant already mid-mutation blocks its ancestor.

The settle is a different atomicity requirement and gets a different mechanism; see D15.

*Buys:* the local record can never disagree with a command the server executes atomically, and a partially-recorded rename — the state that produces today's phantom rows — is unreachable. *Gives up:* one descendant mid-mutation blocks a rename of everything above it, with an error naming a folder the user may not have been thinking about; and the intent's cost scales with subtree size in one transaction, which on SQLite holds the global write slot for its duration.

### D7. A create that the server refuses leaves no row

The intent was that a folder exist; it does not. `pending → failed` for create is removed and the row is deleted instead. This makes `failed` mean exactly one thing — the folder exists at `fullPath` and the last rename or delete intent did not land — which is what the presence predicate already assumes and what a create-failed row quietly violated.

It closes #354 for the create case specifically: no create-failed row lingers for `validateNewFolderName` to reject a re-create against. Rename-failed and delete-failed rows still hold their `fullPath` and still reject a same-name create, and that is correct — the folder really is on the server under that name.

*Buys:* `failed` is safe for every reader; `pending || deleting` stays the exact off-server test. *Gives up:* a create failure leaves no durable trace. The client that asked is told; a client that went away sees a folder that simply is not there. If the create did reach the server and only the acknowledgement was lost, the next sweep discovers the folder and inserts a row for it.

### D8. A confirmed delete removes the folder's local mail, using the primitive that already exists

`deleteMessageSubtree` (`packages/drizzle-service/src/repos/message.ts:116-165`) is the correct primitive and it is already in the tree: it deletes a message plus its nine child tables and writes the `message.removed` outbox row per message, which is what cleans the search index. A bespoke table list would orphan nine tables one level down — the same class of bug this decision exists to fix — and leave deleted mail searchable forever.

The removal is ordered, batched, and resumable rather than one transaction:

1. The row stays `deleting` and visible.
2. The folder's messages are removed in batches of 100 — matching `SUBTREE_BATCH_SIZE` in `account-purge.ts:41` — each batch one transaction over `deleteMessageSubtree` plus that batch's `thread_message` rows.
3. The mailbox's own child rows go: `mailbox_special_use_entry`, `mailbox_attribute_entry`, `mailbox_flag`, `mailbox_lock`, and the mailbox's `message_flag_push` and `message_placement_move` rows.
4. Last, one commit removes the mailbox row.

`filter` also carries `mailbox_id` and is never touched here — D16 is why it never needs to be.

Because the row stays `deleting` until the final commit, a redelivery re-enters the handler, D10's intent guard sees the intent still standing, and the cleanup resumes where it stopped. That is what makes batching safe without a sweep.

*Buys:* no orphaned rows, no deleted mail in the search index, and a bounded write per transaction instead of one unbounded one. *Gives up:* the cleanup is not atomic with the row removal, so a crash mid-way leaves a `deleting` folder with some mail already gone — visibly mid-delete, and resumable, but not a clean rollback. On SQLite each batch holds the global write slot (`tx.ts`, RFC 036 D3), so deleting a large folder measurably delays other writes; 100 messages across eleven tables is the accepted bound.

### D9. A surviving folder name is a successful delete

The tagged OK is the confirmation. Deleting a folder that has children removes the messages and keeps the path as a `\Noselect` placeholder, so the name being present in a later LIST does not mean the delete failed and must not be read as one. The sweep already never inserts a row for a non-selectable folder, so the placeholder acquires no row. D4 refuses this delete at the API anyway; it remains reachable when another client created the children.

*Buys:* one confirmation rule for delete, with no second source that can disagree with it. *Gives up:* a genuinely failed delete that the server nonetheless reports OK for would be recorded as success — accepted, because the alternative is trusting LIST, which is exactly what makes the `\Noselect` case unresolvable.

### D10. A worker re-reads the intent before touching the server

Each handler proceeds only if the row still carries the intent it was enqueued for — `pending` with a matching `pendingPath` for rename, `deleting` for delete, `pending` for create. Otherwise it resolves the job successfully without an IMAP call, logging the outcome as `superseded` or `already-settled`. A redelivered `MAILBOX_RENAME` therefore does not re-issue a rename from a path that has already moved, and a settle whose CAS finds the row already in its target state acks rather than failing. Failing would hold back every later job in the account's FIFO group, which is #339.

This is not a substitute for the tagged-NO handling from #346. Another client can still change the server under an intent that is current, so `NONEXISTENT` and `ALREADYEXISTS` stay classified as they are — with `NONEXISTENT` during a rename routed to D8's removal rather than deleting the mailbox row on its own.

One guard belongs with this: `ImapFlow.mailboxRename` returns `undefined` when the connection is not AUTHENTICATED or SELECTED, and `imapflow-connection.ts:1038-1039` dereferences the result unguarded. Today the value is discarded so the crash is latent; D2 makes it load-bearing. An absent result means RENAME was never issued and must settle as a failure, not raise a `TypeError`.

*Buys:* redelivery is safe and cannot re-issue a mutation against a moved target, and no settle can poison the account's queue. *Gives up:* one extra row read per job, and a genuinely lost settle is indistinguishable from a superseded one in the logs beyond the recorded outcome.

### D11. Unsettled and failed folders are visible

`excludeDeletingMailboxes` is removed and `pendingPath` joins `syncStatus` on `MailboxResponse` (`syncStatus` landed with #348). A folder mid-mutation renders distinguishably from a healthy one and from a failed one, and a failed folder carries a route back to a retry. PR #346 made every reader correctly skip a folder the server does not hold, which turned a stuck mutation into a folder that silently disappears; this is the correction.

*Buys:* a stuck mutation is discoverable by the person it affects, without log access. *Gives up:* every surface listing folders now has states to render, and the folder list stops being a list of folders that certainly exist — callers that assumed a listed folder is navigable have to say what they mean.

### D12. The dependents' R2 choices

| Dependent | Choice | Why |
| --- | --- | --- |
| A filter, move or role appointment binding to a folder | **Wait** — the API refuses a target that is not `synced` (422) | A dangling reference is permanent; blocking costs seconds. PR #348 supplies the client-side wait for create; this is the server-side floor under it. `appointFolderRole` reads the target row today and never looks at its state. |
| `MESSAGE_MOVE`, `MESSAGE_COPY`, `MESSAGE_DELETE`, `EMPTY_TRASH` | **Reconcile** — resolve the path from the row at execution time instead of the event payload | These four carry `mailboxPath` on the event, so a rename settling between enqueue and execution leaves them writing to a path that has moved. Under D2 the row's path is always server-valid, so this needs no wait and no repair path. |
| `FLAG_PUSH`, `PLACEMENT_MOVE_PUSH`, `APPEND_SENT_MESSAGE` | **Immune** — already resolve the path from the row | No change. `APPEND_SENT_MESSAGE` can still append into a `deleting` folder; the mail is lost with the folder, which is the user's own instruction. `PLACEMENT_MOVE_PUSH`'s `[TRYCREATE]` branch (`placement-move-push.ts:314`) creates a folder by path and today can materialise a rename's target on the server, making the RENAME fail `ALREADYEXISTS`; under D2 the target is not a path any row carries, so it cannot. |
| `account-export` | **Immune** — keys export object paths on `fullPath` (`account-export.ts:56`), which D2 keeps confirmed | No change. An export taken mid-rename names the folder by its pre-rename path, which is the path the server held when the export ran. |
| `SYNC_MESSAGES`, `SYNC_MESSAGE_BODY` | **Reconcile** — unchanged from #346 | Skip an unsettled folder and resolve terminally; the next sync round is the repair. |
| The mailbox sweep | **Reconcile** — leave unsettled rows alone, and do not claim a path a recorded rename owns | The reap loop skips `deleting` as well as `pending` (closing #333); the insert branch gets the guard D14 specifies. |
| Folder list and sidebar reads | **Reconcile** — show the state, labelled | R2 permits it for reads. D11 is this choice. |

A rename-pending folder is skipped by message sync even though its `fullPath` is live on the server. That is conservative rather than necessary; it keeps `pending || deleting` as a single expression and costs a few seconds of sync for one folder. The presence helper's name is corrected to say what it now tests — a mutation is in flight — rather than that the folder is absent.

*Buys:* every dependent's behaviour under an in-flight folder mutation is decided in one place and none is left to an implementer's guess. *Gives up:* four handlers stop trusting their own event payloads, which is a small correctness gain bought with a per-job row read; and the wait choice means a script binding to a folder it just created gets a 422 it has to handle rather than an optimistic success.

### D13. Delete-with-move is two operations with an ordering constraint

The delete wizard's "move the mail elsewhere first" is a message move the user chose, then a folder delete. They are separate operations and the API has no combined form.

The constraint: the delete intent may only be recorded once every moved message is confirmed on the server, because DELETE destroys whatever is still in the folder. The gate reads the mailbox row's `messageCount` rather than paging threads — nothing scans a mailbox to answer a state question.

`messageCount` is a sweep-round figure, not a live one: it refreshes when the sweep runs STATUS on the folder, and the sweep skips `pending` and `deleting` rows (`mailbox-sync.ts:183-186`). So the gate reads "the folder was empty as of the last completed sweep round", and the wizard drives a sync round before reading it. That is the freshness bound, and it is the real one.

*Residual failure:* mail delivered into the folder after that sweep round is destroyed with the folder. The window is a sweep round wide, not an instant. IMAP has no atomic empty-and-delete, and no local state can prevent it. *Buys:* the emptiness question is answered by the server, cheaply, without paging a mailbox. *Gives up:* the answer is as fresh as the last sweep round, and the design accepts that rather than adding a per-delete STATUS call.

### D14. The sweep does not insert a row for a path a recorded rename already claims

D2 leaves the sweep's local↔server join keyed on `fullPath` while a rename is in flight, so between the server executing RENAME and the settle write, LIST returns the new path and no row is keyed to it. The insert branch (`mailbox-sync.ts:215-223`) has no state guard, so it would insert a second row with a fresh `mailboxId` and initial-sync the folder's mail into it — the same duplicate-row mechanism as the bug being fixed, arriving through the same branch.

The sweep already loads every local row. It indexes them a second time by `pendingPath` and skips the insert when a row claims the server's path, leaving it to the settle. No extra query, no scan, no reconcile sweep.

*Buys:* D2's window is closed by the reader that would otherwise exploit it, using data already in memory. *Gives up:* the sweep now has to know about intent state to do its job correctly — a coupling that did not exist before — and the guard is code, not a constraint, which is why D17 exists.

### D15. The intent is atomic; the settle is not

Recording an intent is all-or-nothing (D6). Settling one cannot be, because subtree membership can change between the two: the sweep inserts rows, and another client can delete a descendant. An all-or-nothing settle that re-resolves the subtree fails whenever that happens, and both outcomes are unacceptable — throwing poisons the account's FIFO group (#339 again), and resolving leaves every row `pending` forever, invisible to message sync, with no route out because `failed` is only reachable from a settle that ran.

So the settle does not re-resolve the subtree. It applies to exactly the rows that carry the intent, and those rows identify themselves: `pending`, with a `pendingPath` equal to the target or beneath it. Each transitions on its own conditional write — `fullPath = pendingPath`, `pendingPath` cleared, `synced` — and a row that is in the subtree but never carried the intent is not touched. The failure path uses the same set, each row to `failed`.

No row can be left behind, because nothing other than this settle can move a `pending` row, and a row deleted under it is simply skipped. `transitionSubtree` therefore serves the intent only.

*Buys:* a confirmed rename always settles, whatever else happened to the subtree meanwhile, and `failed` stays reachable so the retry route in the transition table always exists. *Gives up:* the settle can leave the subtree in a mixed state — some rows renamed, a newly-appeared sibling not — which is honest about what the server did but means "the subtree renamed atomically" is true of the server and of the intent, not of the projection at every instant.

### D16. A folder that durable references are bound to cannot be deleted

`filter.actionMailboxId` and folder role appointments both name a mailbox and both outlive it. Appointments are `account_setting` rows whose value is a mailboxId string (`folder-role-appointments.ts:118-140`), so a `mailbox_id` column scan does not even find them, and `filter` has no enabled flag — its `actionMailboxId` sentinel `"None"` means "no move action", so clearing the target silently turns a move-filter into a filter that does something else.

Three products were available: delete the bound filters, clear their target, or refuse the delete. Deleting the user's filters as a side effect of deleting a folder is not defensible; clearing the target changes what a filter does without saying so. So the delete is refused with **400**, naming what is bound — `"Receipts" is used by 2 filters and the Archive role. Change those first.` Filters are per-account-config and few, so the check lists them and reads `actionMailboxId`; appointments come from the existing per-account appointment map.

This makes #365's invariant total: a binding can only be created against a settled folder, and can only be removed by the user, so a dangling reference never exists at all.

*Buys:* no dangling references, no silently rewritten user configuration, and no unbind path to design or maintain. *Gives up:* deleting a folder can require the user to go and edit filters first, which is friction the other two options do not have; and the check costs a filter list plus an appointment read on every delete.

### D17. `(accountId, fullPath)` becomes unique

D7, D14 and the transition table all lean on "no duplicate row can be created". That is currently a property of the code paths, not of the schema: there is no unique index on the pair in either dialect, which is precisely what makes the duplicate-row bug silent instead of loud. Two hand-rolled guards now depend on it. A constraint makes the duplicate impossible rather than unlikely, and turns the failure into an error at the moment of the mistake.

The generator supports it — `@compositeUnique` exists in `@kattebak/typespec-drizzle-orm-generator` — though this schema has never used it, so this is the first adoption. It cannot ride along with D1's migration: existing installs can already hold duplicate `(accountId, fullPath)` rows via #318, and adding the index would fail their migrate one-shot. It lands after a dedupe that keeps the row holding the mail and removes the others through D8's path.

*Buys:* the invariant the rest of the design assumes becomes enforced, and any future writer that would duplicate a path fails immediately instead of silently. *Gives up:* the first use of a generator feature in this schema, and a dedupe migration over existing data that must choose a survivor — which is a judgement, not a mechanical merge. Sequenced last for that reason.

## The state machine

`synced` — `fullPath` is the path the server holds; nothing in flight.
`pending-create` — `pending` with no `pendingPath`. No server folder yet; `fullPath` is the requested path.
`pending-rename` — `pending` with `pendingPath`. The server holds `fullPath`; the target is `pendingPath`.
`deleting` — a delete is in flight; the server still holds `fullPath`.
`failed-rename` — `failed` with `pendingPath`. The server holds `fullPath`; the rename did not land.
`failed-delete` — `failed` with no `pendingPath`. The server holds `fullPath`; the delete did not land.

| # | From | To | Trigger |
| --- | --- | --- | --- |
| T1 | (no row) | `pending-create` | Create intent recorded. |
| T2 | `pending-create` | `synced` | Create confirmed; `fullPath` adopts the path ImapFlow resolved. |
| T3 | `pending-create` | (no row) | Create refused (D7). |
| T4 | `synced` \| `failed-*` | `pending-rename` | Rename intent, whole subtree, one transaction (D6). |
| T5 | `pending-rename` | `synced` | Rename confirmed; per row (D15). |
| T6 | `pending-rename` | `failed-rename` | Rename refused; `fullPath` untouched, `pendingPath` kept so the UI can name the target. |
| T7 | `synced` \| `failed-*` | `deleting` | Delete intent. |
| T8 | `deleting` | (no row) | Delete confirmed; the folder's local mail goes with it (D8). |
| T9 | `deleting` | `failed-delete` | Delete refused; nothing to unwind, `fullPath` untouched. |
| T10 | `failed-rename` | `synced` | User dismisses; `pendingPath` cleared. |
| T11 | `failed-delete` | `synced` | User dismisses. |

Every other transition is refused. `pending → deleting` and `deleting → pending` in particular: one intent at a time.

Retry is T4 or T7 from either failed state — the same row and the same `mailboxId`, so no duplicate can be created. Dismissal is T10 or T11, reached without new API surface: a PATCH whose `fullPath` equals the row's confirmed `fullPath` clears `pendingPath` and settles, enqueuing nothing.

## Logging

Every transition logs `mailboxId`, `accountId`, the from-state, the to-state, the intent (`create` / `rename` / `delete`), and the settle outcome — one of `settled`, `refused`, `superseded`, `already-settled`, `conflict`. For a subtree rename, one line per row plus the subtree size on the intent line.

That plus the visible state from D11 and the existing DLQ alarm is what this design builds for observability. A metrics pipeline, traces and alerting on transition rates are not built here; the distro's observability is unsolved as a whole and is not solved as a side effect of two folder operations.

## API surface

No new endpoint and no new request parameter. `POST /accounts/{accountId}/mailboxes`, `PATCH …/{mailboxId}` and `DELETE …/{mailboxId}` keep their paths, methods and request bodies.

**`MailboxResponse` gains `pendingPath`** (read-only, optional). The UI cannot otherwise tell a create in flight from a rename in flight, name the target of a failed rename, or offer the right retry — the row is the only thing that knows what it is renaming to, and no existing field carries it. `syncStatus` is already on the response as of #348. `oldPath` is not on the response and its removal is not a wire change.

**Existing operations gain 400, 409 and 422 outcomes** (D3, D4) using error classes that already exist, following this API's current practice of not declaring error responses in TypeSpec. That practice has a cost this design inherits and names: with no machine-readable code in the body, status is the only thing a client can branch on, which is why the unready-target case takes 422 rather than a second 409. #371 is the standalone issue for the underlying mismatch.

Impact: the generated client's `RemitImapMailboxResponse` gains one optional string, additive for every consumer. The zod schemas and both drizzle schemas regenerate. Two SQLite migrations — a custom backfill and the generated schema change — and the in-process drift test guards the result. The Postgres entity migration set is not in this tree.

## Scope

Two items in the original issue set are separable pre-existing bugs that happen to live in this doc, and they are unblocked by and do not block rename or delete: #364 (four worker jobs trusting a folder path on their event payload) and #371 (the API's declared error shape). They stand alone.

The rest stays in scope, including the parts a simplicity gate would cut. Making unsettled folders visible (D11, #366–#370) is not a separate UX epic: #346 made every reader correctly skip a folder the server does not hold, which is exactly what turned a stuck mutation into a folder that silently disappears, so the visible state is the other half of that change rather than an addition to it. Enforcing the settled-target rule in the backend (D12, #365) is not redundant with the client-side wait in #348: the multi-client case — two tabs, two devices, a script against the API — is the reason the enforcement cannot live in one client's UI.

## FAQ

**Why not keep writing the new path onto the row and store the old one instead?** That is what the code does now, and it is the bug: the row claims a path the server does not hold, so a failure has to restore the folder and every descendant, and it only restores the folder. Storing the target instead makes the revert a field clear.

**Two tabs both hit delete. What does the second one see?** 409, with a message saying a delete is already in progress. Its folder list then shows the folder as `Deleting…`, so the state it lost the race to is visible rather than inferred from the error.

**Why not a lock table? There is already a `mailbox_lock`.** Two sources of truth that can disagree. The state field is read by the sweep, the sync handlers and now the UI; making it also the thing that is enforced means a stuck lock and a stuck state are the same bug, with one place to look.

**What if the queue message is lost after the intent is recorded?** The folder stays `pending` or `deleting` and stays visible as such. The enqueue failing is a 500 to the caller, loud; the workers and the DLQ are monitored. There is no reconcile sweep for unsettled rows and no per-message state — single-machine data loss is out of scope for this design.

**How does a user get out of `failed`?** Retry, which re-records the same intent on the same row, or dismiss, which returns it to `synced` and leaves the folder as it is. Neither creates a second folder.

**A rename half-landed and the sweep added a folder underneath it. Does the rename get stuck?** No. The settle applies to the rows that recorded the intent, identified by their own state, so a row that appeared afterwards is simply not part of it. That is D15, and it is why the settle is not all-or-nothing even though the intent is.

**Deleting a folder wiped its mail from the server. Why keep local rows at all?** It does not — a confirmed delete removes the folder's mail through the same primitive the rest of the codebase uses, which also clears it from the search index. Today they are orphaned and stay searchable, which is a bug this closes.

**Why is deleting a folder's mail not one transaction?** Because a folder can hold tens of thousands of messages and on SQLite one transaction holds the process's only write slot for its whole duration. It is batched and resumable instead: the row stays `deleting` until the last commit, so a redelivery continues rather than restarts.

**The folder is still listed on the server after a successful delete.** Because it had children, so the server kept the name as a placeholder and dropped the messages. That is a completed delete. Confirmation is the tagged OK, never a later LIST.

**Can I delete a folder and everything under it in one go?** No. The API refuses a delete of a folder with child folders, because the server would keep the parent's name and leave the children untouched — an outcome with no local row to describe it. Delete the children first.

**I have a filter pointing at this folder and it won't let me delete it.** Deliberate. The alternatives were deleting your filter for you or quietly changing what it does, and neither is something a folder delete should decide. The error names the filters and roles involved.

**Can I rename INBOX?** No, by refusal. On a real server that operation moves INBOX's mail to the new name and leaves an empty INBOX behind, which is a bulk move wearing a rename's clothes; it would strand the inbox appointment and void the folder's UID cursor. Move the mail instead.

**Why can't I rename a folder to "Archive"?** Because the sweep treats a folder whose leaf name is a known special-use name but which lacks the server's flag as a duplicate, and deletes it — without its mail — when another folder holds the flag. Refusing the rename is cheaper and safer than teaching that heuristic about renames.

**Renaming a folder with ten subfolders — is that eleven mutations?** One. The server renames the subtree in one command; locally it is one intent recorded across eleven rows in one transaction. If any of those eleven is already mid-mutation the whole rename is refused.

**Does a rename move mail or invalidate anything?** No mail moves — `mailboxId` is a random UUID and every message row keys off it, so a rename is a path update. UID survival across a rename is not guaranteed by the spec and servers differ; the existing `UIDVALIDITY` detection trips the cursor rebuild if the server's value changes.

**Is the confirmed path what the server said?** No, and the doc does not claim it. IMAP's RENAME reply carries no path; the adopted value is ImapFlow's own normalization of the requested one, which fixes namespace-prefix and delimiter drift but cannot detect a server that stored a different name.

**I moved mail out and deleted the folder. Could a message arriving right then be destroyed?** Yes, and nothing here prevents it. The gate reads a message count that is as fresh as the last sweep round, so the window is a sweep round wide. IMAP offers no atomic empty-and-delete.

**Why is a folder that is only being renamed skipped by message sync? It exists.** It does, and syncing it would be safe. Skipping it keeps the off-server test a single expression and costs a few seconds for one folder, which is cheaper than a second predicate that readers have to choose between.

**Why 422 and not 409 for binding to an unsettled folder?** Because the response body carries no machine-readable code, so the status is all a client can branch on, and the two cases need different copy and different remedies. It is a choice, not a standard.
