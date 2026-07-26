# Folder mutation states: UX

The visible half of `docs/architecture/folder-rename-and-delete.md`. Decisions there are referenced by number. This document is the source for the Storybook states — every state below is a story, and a state removed here is a story removed there.

## What the client reads

`syncStatus` and `pendingPath` from `MailboxResponse`. Six presentations derive from those two values; nothing else is needed and no boolean crosses the seam.

| `syncStatus` | `pendingPath` | Presentation |
| --- | --- | --- |
| `synced` | — | Healthy. No badge. |
| `pending` | absent | Creating |
| `pending` | present | Renaming |
| `deleting` | — | Deleting |
| `failed` | present | Rename failed |
| `failed` | absent | Delete failed |

A folder is navigable when it is `synced`, `failed`, or renaming. Creating and deleting folders are not: a creating folder holds nothing yet, and a deleting folder's mail is going away.

## Folder rows

Applies to both the sidebar tree and the Settings › Folders list. The name shown is always the confirmed name — a renaming folder reads under its current name with the target in the badge, because that is what the server still holds.

**Creating** — badge `Creating…`, row dimmed, not navigable.
`aria-label`: `Receipts — creating`

**Renaming** — badge `Renaming to “Q3 Receipts”…`, row navigable, name unchanged.
`aria-label`: `Receipts — renaming to Q3 Receipts`

**Deleting** — badge `Deleting…`, row dimmed, not navigable.
`aria-label`: `Receipts — deleting`

**Rename failed** — badge `Rename failed`, in the failure tone. Actions on the row: `Retry rename` and `Keep this name`.
Row detail line: `Couldn’t rename to “Q3 Receipts”.`

**Delete failed** — badge `Delete failed`, failure tone. Actions: `Retry delete` and `Keep this folder`.
Row detail line: `Couldn’t delete this folder. Nothing was removed.`

In the sidebar, where there is no room for row actions, a failed folder carries the badge and links to Settings › Folders. The retry lives in one place.

`Keep this name` and `Keep this folder` are T10 and T11 — they return the folder to healthy and leave it exactly as it is. They are not undo; nothing happened on the server to undo.

## The blocking dialog

Rename and delete block. The blocking is a UX choice on top of the conditional transition, not the correctness mechanism (D3), which is why the dialog's `Close` must never read as a cancel: the intent is recorded and settles whether or not the dialog is open. No state offers a Cancel.

### Rename

**Waiting** — title `Renaming folder`, body `Renaming “Receipts” to “Q3 Receipts” on the mail server…`, spinner. Button: `Close`.

**Timed out** — title `Still renaming`, body `“Receipts” is still being renamed. It will finish on its own — you can close this and keep working. The folder shows “Renaming…” until it does.` Button: `Close`.

**Failed** — title `Rename failed`, body `Couldn’t rename “Receipts”. The mail server refused: <server message>. The folder is unchanged.` Buttons: `Try again`, `Close`.

**Conflict (409)** — title `Already in progress`, body `Something else is already renaming or deleting “Receipts”. Refresh to see where it got to.` Button: `Refresh`.

Success closes the dialog. The list shows the new name.

### Delete

**Waiting** — title `Deleting folder`, body `Deleting “Receipts” and everything in it from the mail server…`, spinner. Button: `Close`.

**Timed out** — title `Still deleting`, body `“Receipts” is still being deleted. It will finish on its own — you can close this. The folder shows “Deleting…” until it does.` Button: `Close`.

**Failed** — title `Delete failed`, body `Couldn’t delete “Receipts”. The mail server refused: <server message>. Nothing was deleted.` Buttons: `Try again`, `Close`. The second sentence is true by construction: DELETE is all-or-nothing (D9).

**Conflict (409)** — as rename, with `deleting or renaming`.

The 30s threshold and the poll interval are `MAILBOX_SYNC_TIMEOUT_MS` and `MAILBOX_SYNC_POLL_INTERVAL_MS`, already exported from `packages/web-client/src/lib/mailbox-sync-wait.ts` by #348. Reuse them; do not restate the number.

## Refusals that never reach a dialog

400 (D4, D16) means the request can never succeed as posed, so the control is unavailable before it is attempted and the reason is in the disabled control's tooltip:

- INBOX delete: `The inbox can’t be deleted.`
- INBOX rename: `The inbox can’t be renamed.`
- has children: `“Receipts” has folders inside it. Delete those first.`
- reserved leaf name, shown inline on the rename field as it is typed: `“Archive” is reserved for a system folder. Pick another name.`
- bound references (D16), shown on the delete control: `“Receipts” is used by 2 filters and the Archive role. Change those first.` The tooltip names them; the dialog is never opened.

A 400 arriving anyway — another client created a child folder or a filter in the meantime — renders in the dialog's failed state with the server's message.

### 422: the folder you pointed at is not ready

Distinct from 409 and deliberately different copy (D4). 409 means *this* folder is already being changed; 422 means the folder you are binding *to* has not settled. It surfaces where the binding is made, not on the folder list:

- filter destination: `“Receipts” isn’t ready yet — the mail server hasn’t confirmed it. Try again in a moment.`
- move destination: same sentence.
- role appointment: `“Receipts” isn’t ready yet. Confirm it on the mail server before giving it a role.`

Inline on the field, with the submit control staying enabled so a retry is one click. No dialog.

## Rename entry point

There is no rename affordance in the client today — the PATCH endpoint exists and no surface has ever sent `fullPath`. It goes in Settings › Folders, as a `Rename` control on each folder row beside `Delete`, opening an inline field.

Field label: `Folder name`
Prefill: the folder's last path segment.
Static context above the field, when the folder has a parent: `Inside: Archive/2025`
Helper text: `Renaming a folder keeps its mail. Folders inside it move with it.`
Submit: `Rename`. Cancel: `Cancel`.

Validation reuses `validateNewFolderName` / `composeFolderPath`. Three refusals are shown inline before submitting: an empty name, a name colliding with a sibling, and a reserved leaf name. The INBOX row's `Rename` and `Delete` are both disabled with the tooltips above.

## Delete wizard

`DeleteFolderDialog` keeps its stages. Two changes:

The empty-check gate reads the mailbox row's `messageCount` rather than paging threads (D13). That figure is as fresh as the last completed sweep round, not live, so the wizard drives a sync round and then reads it — and the copy must not imply otherwise. `Waiting for the mail server to confirm the moved mail…` while the round runs; on the count not reaching zero, the existing copy: `Some mail is still in “Receipts”. Re-open delete to finish removing this folder.`

This dialog has no stories today. It gets them, covering every stage plus the waiting-for-confirmation and conflict states.

## Two surfaces that also read a folder path

Both sit inside D2's stated give-up — during a rename, `fullPath` is the pre-rename path — and both are silent about it today.

`packages/backend/src/handlers/sync.ts:118` returns per-mailbox `fullPath` and a derived `phase` in the sync-progress response, with no `pendingPath`. A folder mid-rename reports its old path with no indication the name is moving. Either carry `pendingPath` alongside it or state that the progress view names folders by their confirmed path; pick one and say so where the response is built.

`packages/web-client/src/lib/search-token-index.ts:46-52` keys the `in:<folder>` token index on the lower-cased `fullPath` and its leaf segment, so during a rename `in:<new name>` silently resolves to nothing while `in:<old name>` still works. Index both `fullPath` and `pendingPath` so the name the user just typed into the rename field is searchable immediately. (Unrelated but adjacent: the leaf split there is hardcoded to `/` rather than the mailbox's `hierarchyDelimiter`.)

## Copy rules used here

Folder names are quoted with typographic quotes and never truncated mid-word in a badge. The server's own refusal text is passed through verbatim after a colon rather than paraphrased — it is the only thing that says why. Nothing tells the user to wait, retry later, or contact anyone; a state that settles on its own says so, and a state that needs an action offers the action.
