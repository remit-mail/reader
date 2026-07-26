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

`Keep this name` and `Keep this folder` are T10 — they return the folder to healthy and leave it exactly as it is. They are not undo; nothing happened on the server to undo.

## The blocking dialog

Rename and delete block (D3 note: the blocking is a UX choice; correctness comes from the conditional transition). The dialog owns four states. Its `Close` never cancels the mutation — the intent is recorded and settles on its own — so no state offers a Cancel.

### Rename

**Waiting** — title `Renaming folder`, body `Renaming “Receipts” to “Q3 Receipts” on the mail server…`, spinner. Button: `Close`.

**Timed out** (30s, matching the create wait in PR #348) — title `Still renaming`, body `“Receipts” is still being renamed. It will finish on its own — you can close this and keep working. The folder shows “Renaming…” until it does.` Button: `Close`.

**Failed** — title `Rename failed`, body `Couldn’t rename “Receipts”. The mail server refused: <server message>. The folder is unchanged.` Buttons: `Try again`, `Close`.

**Conflict (409)** — title `Already in progress`, body `Something else is already renaming or deleting “Receipts”. Refresh to see where it got to.` Button: `Refresh`.

Success closes the dialog. The list shows the new name.

### Delete

**Waiting** — title `Deleting folder`, body `Deleting “Receipts” and everything in it from the mail server…`, spinner. Button: `Close`.

**Timed out** — title `Still deleting`, body `“Receipts” is still being deleted. It will finish on its own — you can close this. The folder shows “Deleting…” until it does.` Button: `Close`.

**Failed** — title `Delete failed`, body `Couldn’t delete “Receipts”. The mail server refused: <server message>. Nothing was deleted.` Buttons: `Try again`, `Close`. The second sentence is true by construction: DELETE is all-or-nothing (D9).

**Conflict (409)** — as rename, with `deleting or renaming`.

**Refused (400)** — no dialog; the action is unavailable before it is attempted, with the reason in the disabled control's tooltip:
- INBOX: `The inbox can’t be deleted.`
- has children: `“Receipts” has folders inside it. Delete those first.`
- INBOX rename: `The inbox can’t be renamed.`

A 400 arriving anyway (another client created a child folder in the meantime) renders in the dialog's failed state with the server's message.

## Rename entry point

There is no rename affordance in the client today — the PATCH endpoint exists and no surface has ever sent `fullPath`. It goes in Settings › Folders, as a `Rename` control on each folder row beside `Delete`, opening an inline field.

Field label: `Folder name`
Prefill: the folder's last path segment.
Static context above the field, when the folder has a parent: `Inside: Archive/2025`
Helper text: `Renaming a folder keeps its mail. Folders inside it move with it.`
Submit: `Rename`. Cancel: `Cancel`.

Validation reuses `validateNewFolderName` / `composeFolderPath`. Two refusals are shown inline before submitting, not as a round trip: an empty name, and a name colliding with a sibling. The INBOX row's `Rename` and `Delete` are both disabled with the tooltips above.

## Delete wizard

`DeleteFolderDialog` keeps its stages. Two changes:

The empty-check gate reads the mailbox row's `messageCount` rather than paging threads (D13) — the folder is empty when the server says it is empty.

Between the last confirmed move and the delete, the wizard shows `Waiting for the mail server to confirm the moved mail…`. If the count does not reach zero within the wait: `Some mail is still in “Receipts”. Re-open delete to finish removing this folder.` — the existing copy, now reached from a server-reported count.

This dialog has no stories today. It gets them, covering every stage plus the two states above.

## Copy rules used here

Folder names are quoted with typographic quotes and never truncated mid-word in a badge. The server's own refusal text is passed through verbatim after a colon rather than paraphrased — it is the only thing that says why. Nothing tells the user to wait, retry later, or contact anyone; a state that settles on its own says so, and a state that needs an action offers the action.
