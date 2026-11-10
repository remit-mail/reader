# Folder rename and delete

Applies the IMAP mutation rules (`imap-mutations.md`) to folder create, rename and delete. R1 (record pending, settle on confirmation) and R2 (every dependent chooses wait or reconcile, explicitly) are not re-opened here; this document says what they mean for these operations.

## Decisions

### D1. The mailbox row is the durable record, and its state field is total

`syncStatus` is required with a default of `synced`, over `synced`, `pending`, `deleting` and `failed`. A row the sweep inserted from a server LIST is confirmed, so it is `synced`. The transitions in D3 are SQL predicates, so a row with no `syncStatus` could never start a mutation.

### D2. `fullPath` is always a path the server holds; the rename target lives in `pendingPath`

A rename records the target in `pendingPath` and leaves `fullPath` alone. The settle writes the confirmed path into `fullPath` and clears `pendingPath`.

Because `fullPath` never names a path the server does not hold, nothing that resolves a folder path from the row is exposed to a path that does not exist, and a failed rename needs no unwinding for the folder or its descendants: dropping `pendingPath` is the whole revert.

The confirmed path is the one ImapFlow resolved, not one the server echoed. IMAP's RENAME reply carries no path; `ImapFlow.mailboxRename` returns a `newPath` built client-side with the namespace prefix applied, special names resolved and the delimiter joined. That fixes namespace-prefix and delimiter drift, but it does not detect a server that stores a different name, and D9 forbids treating a later LIST as authoritative. That case is not covered.

### D3. Every transition is a conditional write, and the state field is the lock

`MailboxRepo` sets state only when the row is in an accepted from-state, as one `UPDATE … WHERE … syncStatus IN (…) RETURNING`. No `mailbox_lock` row participates: a second mechanism that can disagree with `syncStatus` is worse than one that is enforced. The predicate being on `syncStatus` rather than on `updatedAt` also means an unrelated metadata write — the sweep persisting fresh counters — cannot make a transition lose.

The predicate is over the six states below, not over the four enum values: `pending` covers both a create and a rename in flight, and `failed` covers both a failed rename and a failed delete. The transition therefore also takes a `pendingPath` predicate — a value to match, or explicitly absent — and every caller that means one of the six states supplies it.

Without it a redelivered create can settle a row a rename has claimed. A create settles; its acknowledgement is lost; the user renames the folder; the create is redelivered, CREATE collides and ImapFlow reports `{created: false}`, which is treated as success; the create settle writes `synced` while `pendingPath` is still set. The rename settle's guard then no longer matches, and the RENAME never runs.

**Invariant: `pendingPath` is non-null only while `syncStatus` is `pending` or `failed`.** The create settle's predicate requires `pendingPath` absent, so it does not match a row a rename has claimed, and the create resolves as superseded. The invariant spans two columns, so it is not expressible as a database CHECK; it holds because the transition is the only writer of either field. `syncStatus` and `pendingPath` are absent from `UpdateMailboxInput`, so bypassing the transition is a type error.

A client that loses the compare-and-set gets **409** naming the intent already in flight. Existence is established by the handler's read beforehand, so a lost CAS is a conflict; when the row disappeared in between, a single primary-key read on the conflict path reports it as 404.

### D4. A refusal that can never succeed is 400, a race is 409, an unready target is 422

400: deleting INBOX, renaming INBOX, renaming a folder to a path that canonicalizes to INBOX or to a reserved leaf name (D5), deleting a folder that has child folders, deleting a folder that durable references are bound to (D16). None become possible by retrying the same request.

409: only a lost compare-and-set on the folder being mutated.

422: a write that binds to a folder whose own mutation has not settled (D12, first row). The error body carries no machine-readable code, so the status is the only thing a client can branch on, and "something else is already changing this folder" and "the folder you are pointing at is not ready yet" need different copy.

### D5. Renaming INBOX is refused, and so is renaming to a reserved leaf name

The server would move INBOX's messages to the new name and leave INBOX behind, empty. That strands the account's inbox appointment on the renamed row, and the moved messages get new UIDs under a different `UIDVALIDITY`, voiding the row's cursor.

Renaming *to* a reserved leaf name is refused because the sweep decides duplicate special-use folders on the leaf segment (`trash`, `bin`, `drafts`, `sent`, `junk`, `spam`, `archive` and their variants). A rename to any of those settles, and then the next sweep deletes the row — without its mail — whenever another folder holds the corresponding flag. The refusal uses the sweep's own predicate, so the two cannot disagree.

A user who wants either outcome moves the mail.

### D6. A subtree rename is one intent recorded over N rows, in one transaction

RENAME renames the whole subtree on the server in one command, so recording the intent is all-or-nothing: one conditional UPDATE over the folder and every row under its path, each to `pending` with its own rewritten `pendingPath`. If any row in the subtree is not in an accepted from-state, the whole intent is refused with 409 — a descendant already mid-mutation blocks its ancestor.

The settle is a different atomicity requirement; see D15.

### D7. A create that the server refuses leaves no row

The row is deleted instead of moving to `failed`. `failed` therefore means exactly one thing — the folder exists at `fullPath` and the last rename or delete intent did not land. If the create did reach the server and only the acknowledgement was lost, the next sweep discovers the folder and inserts a row for it.

### D8. A confirmed delete removes the folder's local mail

The messages go through `deleteMessageSubtree`, which deletes a message plus its child tables and writes the `message.removed` outbox row per message that cleans the search index. Then the mailbox's own child rows go, and last the mailbox row.

The removal is ordered, batched and resumable rather than one transaction: on SQLite one transaction holds the process's only write slot for its whole duration. The row stays `deleting` and visible until the final commit, so a redelivery re-enters the handler, D10's guard sees the intent still standing, and the cleanup resumes where it stopped.

A delete whose queue message lands in the DLQ leaves the row `deleting` indefinitely, with some of the folder's mail possibly already removed. There is deliberately **no user-facing retry** for it: what has failed is the worker or a dependency, and a button that only re-enqueues would let a user press it repeatedly against a broken worker while making the failure look like theirs. The DLQ alarm owns this.

### D9. A surviving folder name is a successful delete

The tagged OK is the confirmation. Deleting a folder that has children removes the messages and keeps the path as a `\Noselect` placeholder, so the name being present in a later LIST does not mean the delete failed. The sweep never inserts a row for a non-selectable folder. D4 refuses this delete at the API; it remains reachable when another client created the children.

### D10. A worker re-reads the intent before touching the server

Each handler proceeds only if the row still carries the intent it was enqueued for, and the guard names one of the six states: `pending` with `pendingPath` matching the event's target for rename, `pending` with `pendingPath` **absent** for create, `deleting` for delete. Otherwise it resolves the job successfully without an IMAP call, logging `superseded` or `already-settled`. A settle whose CAS finds the row already in its target state acks rather than failing, because failing holds back every later job in the account's FIFO group.

`NONEXISTENT` on a RENAME has three readings, and only one of them may destroy anything. Either another client deleted the folder; or this rename already landed and only its settle was lost, so a redelivery re-issues RENAME from a path that no longer exists; or the server is saying something this code cannot classify. The server's own listing, read through the account's namespace prefix, separates the first two — a present target means this rename landed, and the settle runs against it. Everything the listing cannot answer is a refused rename: a failed rename costs a retry, while an unclear answer read as a delete costs the user their mail. The removal path is reached only by a distinct error raised where the listing held neither path.

`ImapFlow.mailboxRename` returns `undefined` when the connection is not AUTHENTICATED or SELECTED. An absent result means RENAME was never issued and settles as a failure.

### D11. Unsettled and failed folders are listed

The folder list returns `deleting`, `pending` and `failed` rows with `syncStatus` and `pendingPath` on `MailboxResponse`. Hiding them turned a stuck mutation into a folder that silently disappears.

### D12. The dependents' R2 choices

| Dependent | Choice | Why |
| --- | --- | --- |
| A filter, move or role appointment binding to a folder | **Wait** — the API refuses a target that is not `synced` (422) | A dangling reference is permanent; blocking costs seconds. |
| `MESSAGE_MOVE`, `MESSAGE_COPY`, `MESSAGE_DELETE`, `EMPTY_TRASH` | **Reconcile** — resolve the path from the row at execution time instead of the event payload | A rename settling between enqueue and execution would leave a payload path that has moved. Under D2 the row's path is always server-valid. |
| `FLAG_PUSH`, `PLACEMENT_MOVE_PUSH`, `APPEND_SENT_MESSAGE` | **Immune** — resolve the path from the row | `APPEND_SENT_MESSAGE` can still append into a `deleting` folder; the mail is lost with the folder, which is the user's own instruction. |
| `account-export` | **Immune** — keys export object paths on `fullPath`, which D2 keeps confirmed | An export taken mid-rename names the folder by the path the server held when it ran. |
| `SYNC_MESSAGES`, `SYNC_MESSAGE_BODY` | **Reconcile** | Skip an unsettled folder and resolve terminally; the next sync round is the repair. |
| The mailbox sweep | **Reconcile** — leave unsettled rows alone, and do not claim a path a recorded rename owns | See D14. |
| Folder list reads | **Reconcile** — show the state | D11. |

A rename-pending folder is skipped by message sync even though its `fullPath` is live on the server. That keeps `pending || deleting` as the single off-server test and costs a few seconds of sync for one folder.

### D13. Delete-with-move is two operations with an ordering constraint

"Move the mail elsewhere first" is a message move, then a folder delete; the API has no combined form. The delete intent may only be recorded once every moved message is confirmed on the server, because DELETE destroys whatever is still in the folder. The gate reads the mailbox row's `messageCount` rather than paging threads.

D16's bindings check runs **before** the move stage, so a user is not told to edit a filter after moving thousands of messages.

`messageCount` refreshes when the sweep runs STATUS on the folder, so the gate reads "the folder was empty as of the last completed sweep round". Mail delivered into the folder after that round is destroyed with the folder. IMAP has no atomic empty-and-delete, and no local state can prevent it.

### D14. The sweep does not insert a row for a path a recorded rename already claims

Between the server executing RENAME and the settle write, LIST returns the new path and no row is keyed to it. Without a guard the sweep would insert a second row with a fresh `mailboxId` and initial-sync the folder's mail into it. The sweep indexes its local rows a second time by `pendingPath` and skips the insert when a row claims the server's path, leaving it to the settle.

### D15. The intent is atomic; the settle is not

Subtree membership can change between intent and settle: the sweep inserts rows, and another client can delete a descendant. An all-or-nothing settle that re-resolves the subtree would fail whenever that happens — throwing poisons the account's FIFO group, and resolving leaves every row `pending` forever.

So the settle applies to exactly the rows that carry the intent. Each transitions on its own conditional write — `fullPath = pendingPath`, `pendingPath` cleared, `synced` — and a row in the subtree that never carried the intent is not touched. The failure path and the dismissal use the same set.

**Row identity is the pair, not the target alone.** A row carries the rename `oldPath → newPath` when it is `pending`, its `fullPath` is `oldPath` or beneath it under the renamed folder's delimiter, **and** its `pendingPath` is exactly what rebasing that `fullPath` from `oldPath` to `newPath` produces. Matching on the target alone breaks when two folders hold targets under one branch — `Work → Projects` in flight while `Other → Projects/Old` is recorded. The delimiter is the renamed folder's own, read from the row the settle already holds.

**The named folder settles last.** The redelivery's guard reads that row and nothing else, so while it still carries the intent, a redelivery re-enters and finishes whatever the last attempt left. Settling it first would ack a run that died part-way through its descendants and leave them `pending` forever.

**Nothing after the server RENAME may reach the failure path.** Once the server has executed the command the rename has happened, so a settle that cannot finish is not a refused rename. Marking the rows `failed` there would offer a retry of work already done and leave `fullPath` naming a path the server no longer holds. It is raised as its own kind and rethrown: the rows are still `pending` with their targets recorded, so the redelivery's guard passes and the settle runs again. Display-only work — the paths recorded beside role appointments — is logged and dropped instead.

### D16. A folder that durable references are bound to cannot be deleted

A binding is only ever created against a settled folder (D12) and only ever removed by the user, so a `mailboxId` that names nothing never exists, and no reader of a filter's `actionMailboxId` or a role appointment needs a missing-target branch.

The alternatives both rewrite user configuration. `filter` has no enabled flag, and its `actionMailboxId` sentinel `"None"` means "no move action", so clearing the target silently turns a move-filter into one that does something else. Deleting the bound filters is not a decision a folder delete gets to make.

So the delete is refused with **400**, and the error names what is bound and links to it. Role appointments are `account_setting` rows whose value is a mailboxId string, so a `mailbox_id` column scan does not find them; the check reads the per-account appointment map and the account config's filters.

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

Retry is T4 or T7 from either failed state — the same row and the same `mailboxId`, so no duplicate can be created. Dismissal is a PATCH whose `fullPath` equals the row's confirmed `fullPath`: it clears `pendingPath` and settles, enqueuing nothing.
