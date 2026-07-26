# Folder rename and delete

Applies the IMAP mutation rules (`imap-mutations.md`) to folder rename and folder delete. R1 (record pending, settle on confirmation) and R2 (every dependent chooses wait or reconcile, explicitly) are not re-opened here; this document says what they mean for these two operations and what has to change to satisfy them.

Folder create already follows R1 on the settle side. PR #346 supplied the reconcile half for sync: a job that targets a folder the server does not hold resolves instead of failing, which stopped a folder mutation stalling an account's whole mail sync for a queue visibility window (#339). Rename and delete still violate R1 on the record side — they write server truth locally before the server has confirmed anything — and delete leaves the local projection of a folder's mail behind.

## What is wrong today

A rename writes the new path onto the row immediately (`mailbox-queue.ts:167`) and marks it `pending`. The row now claims a path the server does not hold. When the rename then fails, the worker sets `syncStatus: failed` and restores `fullPath` from the event (`handlers/mailbox-management.ts:267`) — but only for the renamed folder, never for its descendants, whose paths `renameChildPaths` already rewrote. Those descendant rows are left pointing at paths that do not exist, in a state (`failed`) that the presence predicate treats as on-server. The next mailbox sweep finds each real server path unmatched, inserts a fresh row with a new `mailboxId`, and reaps the stale one. Every `message` and `thread_message` row keyed to the old `mailboxId` is orphaned — there is no foreign key and no cascade anywhere in the schema, and nothing cleans up per-mailbox mail rows.

A delete marks the row `deleting`, and the list response hides `deleting` rows (`handlers/mailbox.ts:203`). A folder whose delete does not settle therefore vanishes from the UI while still existing on the server. When the delete does settle, `syncDelete` removes the mailbox row alone; the folder's `message`, `thread_message` and `mailbox_special_use_entry` rows stay forever. The reap loop skips `pending` rows but not `deleting` ones, so a sweep that runs after the server-side delete lands but before the worker writes back hard-deletes the row under the client holding its id, which is the "Mailbox not found" seen in #333.

Neither operation is guarded against a second client. `MailboxRepo.update` has no from-state predicate anywhere in the repo layer, so two tabs both issuing a delete both record intent and both enqueue.

## Decisions

### D1. The mailbox row is the durable record, and its state field is total

`syncStatus` becomes required with a default of `synced`, over the values it already has: `synced`, `pending`, `deleting`, `failed`. The rows that currently read back as absent are the ones the mailbox sweep inserted from a server LIST — a folder the server just told us about is confirmed — so the migration backfills them to `synced` and the sweep's insert path writes it explicitly.

*Buys:* one field answers "is a mutation in flight on this folder", with no fourth case for every reader to remember. *Gives up:* a migration over an existing column, and the ability to tell a sweep-born row from a create-confirmed one.

### D2. `fullPath` is always a path the server holds; the rename target lives in `pendingPath`

A rename records the target in a new `pendingPath` field and leaves `fullPath` alone. The settle writes the server's confirmed path into `fullPath` and clears `pendingPath`. The dead `oldPath` column — never written by any code path, documented as the inverse of what is needed — is dropped.

This is the load-bearing decision. Because `fullPath` never names a path the server does not hold, an in-flight rename cannot break anything that resolves a folder path from the row: the path stays valid right up to the moment the server confirms the new one. A failed rename needs no unwinding at all, for the folder or its descendants — the projection never lied, so dropping `pendingPath` is the whole revert. And the sweep's path-keyed match keeps working mid-rename instead of needing a special case.

*Buys:* the revert is a field clear rather than a multi-row restore; no dependent operation is exposed to a path that does not exist. *Gives up:* until the rename settles the UI shows the old name (labelled with the target), and a reader wanting the requested name must read a second field.

### D3. Every transition is a conditional write, and the state field is the lock

`MailboxRepo` gains a transition that sets state only when the row is in an accepted from-state, as one `UPDATE ... WHERE ... RETURNING`. No `mailbox_lock` row participates: a second mechanism that can disagree with `syncStatus` is worse than one that is enforced.

A client that loses the compare-and-set gets **409** with a message naming the intent already in flight — `A delete is already in progress for "Receipts".` The 409 carries no retry advice; the folder list now shows the state, so the client refreshes and sees it. Existence is established by the handler's `assertMailboxInAccount` read before the transition, so a lost CAS is a conflict; the one case where the row disappeared in between is classified by a single primary-key read on the conflict path and reported as 404.

`ConflictError` (409) already exists in `data-ports/src/errors.ts` and is already thrown by two handlers without a TypeSpec declaration. This follows that practice rather than introducing a response-union convention for one operation. The pre-existing mismatch between the TypeSpec `ApiError` shape and what `formatResponse` actually emits is a separate defect.

*Buys:* correctness with more than one client, from the field the readers already consult. *Gives up:* no queue position or wait time is reported to the loser; it learns the state, not the ETA.

### D4. A refusal that can never succeed is 400; a race is 409

400: deleting INBOX, renaming INBOX, renaming a folder to a path that canonicalizes to INBOX, deleting a folder that has child folders. None of these become possible by retrying. 409: only a lost compare-and-set.

The client can act on the split — 409 means refresh, 400 means the request itself is wrong — without parsing messages. Today the INBOX delete refusal happens in the worker, which marks the row `synced` after the API already accepted a delete it could never perform; that check moves to the handler and stays in the worker as a backstop.

### D5. Renaming INBOX is refused

The server would move INBOX's messages to the new name and leave INBOX behind, empty. That is a bulk move plus a folder that outlives it, not a path update: it strands the account's inbox appointment on the renamed row, and the moved messages get new UIDs under a different `UIDVALIDITY`, voiding the row's cursor. A user who wants that outcome moves the mail, which is an operation that already exists.

*Buys:* rename keeps one meaning — a path update, no mail moves — with no exception to carry through the settle, the cursor logic and the role appointments. *Gives up:* a capability the server offers. `validateMailboxOperation`'s current test asserting INBOX rename is allowed inverts.

### D6. A subtree rename is one intent recorded over N rows, in one transaction

RENAME renames the whole subtree on the server in one command, so the local record must be all-or-nothing too. The intent transitions the folder and every descendant in one transaction, each to `pending` with its own rewritten `pendingPath`. If any row in the subtree is not in an accepted from-state, the whole intent is refused with 409 — a subtree cannot be half-renamed, so a descendant already mid-mutation blocks its ancestor.

The settle adopts the path the server echoed. `IImapConnection.renameMailbox` already returns `{path, newPath}` and `syncRename` currently discards it; the parent takes the echoed `newPath` and each descendant's confirmed path is re-derived by re-prefixing from it, so a server that normalizes the target does not leave the subtree pointing at the requested spelling. One transaction, mirroring the record side.

### D7. A create that the server refuses leaves no row

The intent was that a folder exist; it does not. `pending → failed` for create is removed and the row is deleted instead. This makes `failed` mean exactly one thing — the folder exists at `fullPath` and the last rename or delete intent did not land — which is what the presence predicate already assumes and what a create-failed row quietly violated. It also closes #354: there is no lingering row for name validation to reject a re-create against, and a retry is a fresh create rather than a duplicate.

*Buys:* `failed` is safe for every reader; `pending || deleting` stays the exact off-server test. *Gives up:* a create failure leaves no durable trace. The client that asked is told; a client that went away sees a folder that simply is not there. If the create did reach the server and only the acknowledgement was lost, the next sweep discovers the folder and inserts a row for it.

### D8. A confirmed delete removes the folder's local mail with its row

One code path removes a mailbox row together with its `message`, `thread_message` and `mailbox_special_use_entry` rows, in one transaction, and both the settled delete and the "the server says this folder is gone" case use it. Deleting the row alone leaves orphaned mail rows keyed to a dead `mailboxId`, which is what happens today on every folder delete.

### D9. A surviving folder name is a successful delete

The tagged OK is the confirmation. Deleting a folder that has children removes the messages and keeps the path as a `\Noselect` placeholder, so the name being present in a later LIST does not mean the delete failed and must not be read as one. The sweep already never inserts a row for a non-selectable folder, so the placeholder acquires no row. D4 refuses this delete at the API anyway; it remains reachable when another client created the children.

### D10. A worker re-reads the intent before touching the server

Each handler proceeds only if the row still carries the intent it was enqueued for — `pending` with a matching `pendingPath` for rename, `deleting` for delete, `pending` for create. Otherwise it resolves the job successfully without an IMAP call, logging the outcome as `superseded` or `already-settled`. A redelivered `MAILBOX_RENAME` therefore does not re-issue a rename from a path that has already moved, and a settle whose CAS finds the row already in its target state acks rather than failing. Failing would hold back every later job in the account's FIFO group, which is #339.

This is not a substitute for the tagged-NO handling from #346. Another client can still change the server under an intent that is current, so `NONEXISTENT` and `ALREADYEXISTS` stay classified as they are — with `NONEXISTENT` during a rename now routed to D8 rather than deleting the mailbox row on its own.

### D11. Unsettled and failed folders are visible

`excludeDeletingMailboxes` is removed and `pendingPath` joins `syncStatus` on `MailboxResponse`. A folder mid-mutation renders distinguishably from a healthy one and from a failed one, and a failed folder carries a route back to a retry. This is the observability that matters: PR #346 made every reader correctly skip a folder the server does not hold, which turned a stuck mutation into a folder that silently disappears.

### D12. The dependents' R2 choices

| Dependent | Choice | Why |
| --- | --- | --- |
| A filter, move or role appointment binding to a folder | **Wait** — the API refuses a target that is not `synced` (409) | A dangling reference is permanent; blocking costs seconds. PR #348 supplies the client-side wait for create; this is the server-side floor under it. `appointFolderRole` reads the target row today and never looks at its state. |
| `MESSAGE_MOVE`, `MESSAGE_COPY`, `MESSAGE_DELETE`, `EMPTY_TRASH` | **Reconcile** — resolve the path from the row at execution time instead of the event payload | These four carry `mailboxPath` on the event, so a rename settling between enqueue and execution leaves them writing to a path that has moved. `FLAG_PUSH` and `PLACEMENT_MOVE_PUSH` already resolve from the row and are immune. Under D2 the row's path is always server-valid, so this needs no wait and no repair path — it is one line per handler. |
| `SYNC_MESSAGES`, `SYNC_MESSAGE_BODY` | **Reconcile** — unchanged from #346 | Skip an unsettled folder and resolve terminally; the next sync round is the repair. |
| The mailbox sweep | **Reconcile** — leave unsettled rows alone | Extended: the reap loop skips `deleting` as well as `pending`, because a `deleting` row's absence from LIST is expected and the worker owns its removal. This closes #333. |
| Folder list and sidebar reads | **Reconcile** — show the state, labelled | R2 permits it for reads. D11 is this choice. |

A rename-pending folder is skipped by message sync even though its `fullPath` is live on the server. That is conservative rather than necessary; it keeps `pending || deleting` as a single expression and costs a few seconds of sync for one folder. The presence helper's name is corrected to say what it now tests — a mutation is in flight — rather than that the folder is absent.

### D13. Delete-with-move is two operations with an ordering constraint

The delete wizard's "move the mail elsewhere first" is a message move the user chose, then a folder delete. They are separate operations and the API has no combined form.

The constraint: the delete intent may only be recorded once every moved message is confirmed on the server, because DELETE destroys whatever is still in the folder. The wizard waits (R2 wait) for the server-reported message count on the mailbox row to reach zero, re-read immediately before it issues the DELETE. It reads the row's `messageCount`, which STATUS maintains — not a page-through of threads.

*Residual failure:* mail delivered into the folder between that read and the server executing DELETE is destroyed. IMAP has no atomic empty-and-delete, and no local state can prevent it. Stated rather than mitigated.

## The state machine

`synced` — `fullPath` is the path the server holds; nothing in flight.
`pending` — a create or rename is in flight. Without `pendingPath` it is a create: no server folder yet, `fullPath` is the requested path. With `pendingPath` it is a rename: the server holds `fullPath`, the target is `pendingPath`.
`deleting` — a delete is in flight; the server still holds `fullPath`.
`failed` — the server holds `fullPath`; the last rename or delete intent did not land. `pendingPath` present means it was a rename, absent means a delete.

| # | From | To | Trigger |
| --- | --- | --- | --- |
| T1 | (no row) | `pending` | Create intent recorded. |
| T2 | `pending` | `synced` | Create confirmed; `fullPath` adopts the server's normalized path. |
| T3 | `pending` | (no row) | Create refused (D7). |
| T4 | `synced` \| `failed` | `pending` + `pendingPath` | Rename intent, whole subtree, one transaction (D6). |
| T5 | `pending` | `synced` | Rename confirmed; `fullPath` takes the echoed path, `pendingPath` cleared, subtree in one transaction. |
| T6 | `pending` | `failed` | Rename refused; `fullPath` untouched, `pendingPath` kept so the UI can name the target. |
| T7 | `synced` \| `failed` | `deleting` | Delete intent. |
| T8 | `deleting` | (no row) | Delete confirmed; the folder's local mail rows go with it (D8). |
| T9 | `deleting` | `failed` | Delete refused; nothing to unwind, `fullPath` untouched. |
| T10 | `failed` | `synced` | User dismisses a failure. |

Every other transition is refused. `pending → deleting` and `deleting → pending` in particular: one intent at a time.

Retry is T4 or T7 from `failed` — the same row and the same `mailboxId`, so no duplicate can be created. Dismissal is T10, reached without new API surface: a PATCH whose `fullPath` equals the row's confirmed `fullPath` clears `pendingPath` and settles, enqueuing nothing.

## Logging

Every transition logs `mailboxId`, `accountId`, the from-state, the to-state, the intent (`create` / `rename` / `delete`), and the settle outcome — one of `settled`, `refused`, `superseded`, `already-settled`, `conflict`. For a subtree rename, one line per row plus the subtree size on the intent line. That, plus the visible state from D11 and the existing DLQ alarm, is the whole observability story here. The distro's observability is unsolved and nothing more is built for it now; half an observability layer is worse than logs and an honest UI.

## API surface

No new endpoint and no new request parameter. `POST /accounts/{accountId}/mailboxes`, `PATCH …/{mailboxId}` and `DELETE …/{mailboxId}` keep their paths, methods and request bodies.

**`MailboxResponse` gains `pendingPath`** (read-only, optional). The UI cannot otherwise tell a create in flight from a rename in flight, name the target of a failed rename, or offer the right retry — the row is the only thing that knows what it is renaming to, and no existing field carries it. `syncStatus` is added to the same response by PR #348 and is a dependency of this work, not a duplicate of it. `oldPath` is not on the response and its removal is not a wire change.

**Existing operations gain 400 and 409 outcomes** (D3, D4) using error classes that already exist and are already thrown elsewhere without TypeSpec declarations.

Impact: the generated client's `RemitImapMailboxResponse` gains one optional string, which is additive for every consumer. The zod schemas and both drizzle schemas regenerate. One SQLite migration adds `pending_path`, drops `old_path`, and makes `sync_status` NOT NULL with a `synced` default and a backfill; the in-process drift test guards it. The Postgres entity migration set is not in this tree.

## FAQ

**Why not keep writing the new path onto the row and store the old one instead?** That is what the code does now, and it is the bug: the row claims a path the server does not hold, so a failure has to restore the folder and every descendant, and anything that resolves a path from the row in that window gets one that does not exist. Storing the target instead makes the revert a field clear.

**Two tabs both hit delete. What does the second one see?** 409, with a message saying a delete is already in progress. Its folder list then shows the folder as `Deleting…`, so the state it lost the race to is visible rather than inferred from the error.

**Why not a lock table? There is already a `mailbox_lock`.** Two sources of truth that can disagree. The state field is read by the sweep, the sync handlers and now the UI; making it also the thing that is enforced means a stuck lock and a stuck state are the same bug, with one place to look.

**What if the queue message is lost after the intent is recorded?** The folder stays `pending` or `deleting` and stays visible as such. The enqueue failing is a 500 to the caller, loud; the workers and the DLQ are monitored. There is no reconcile sweep for unsettled rows and no per-message state — single-machine data loss is out of scope for this design.

**How does a user get out of `failed`?** Retry, which re-records the same intent on the same row, or dismiss, which returns it to `synced` and leaves the folder as it is. Neither creates a second folder.

**Deleting a folder wiped its mail from the server. Why keep local rows at all?** It does not — a confirmed delete removes the folder's local mail rows in the same transaction as the folder. Today they are orphaned, which is a bug this closes.

**The folder is still listed on the server after a successful delete.** Because it had children, so the server kept the name as a placeholder and dropped the messages. That is a completed delete. Confirmation is the tagged OK, never a later LIST.

**Can I delete a folder and everything under it in one go?** No. The API refuses a delete of a folder with child folders, because the server would keep the parent's name and leave the children untouched — an outcome with no local row to describe it. Delete the children first.

**Can I rename INBOX?** No, by refusal. On a real server that operation moves INBOX's mail to the new name and leaves an empty INBOX behind, which is a bulk move wearing a rename's clothes; it would strand the inbox appointment and void the folder's UID cursor. Move the mail instead.

**Renaming a folder with ten subfolders — is that eleven mutations?** One. The server renames the subtree in one command; locally it is one intent recorded across eleven rows in one transaction and settled the same way. If any of those eleven is already mid-mutation the whole rename is refused.

**Does a rename move mail or invalidate anything?** No mail moves — `mailboxId` is a random UUID and every message row keys off it, so a rename is a path update. UID survival across a rename is not guaranteed by the spec and servers differ; the existing `UIDVALIDITY` detection trips the cursor rebuild if the server's value changes.

**I moved mail out and deleted the folder. Could a message arriving right then be destroyed?** Yes, and nothing here prevents it. The delete waits for the server to report the folder empty, but IMAP offers no atomic empty-and-delete, so a delivery landing between that check and the DELETE is lost with the folder.

**Why is a folder that is only being renamed skipped by message sync? It exists.** It does, and syncing it would be safe. Skipping it keeps the off-server test a single expression and costs a few seconds for one folder, which is cheaper than a second predicate that readers have to choose between.
