import "typespec-electrodb-emitter";

import "../enums/MessageFlagPushState.tsp";
import "../enums/FlagPushOperation.tsp";

namespace RemitImap;

@doc("""
  Pending flag-push marker (issue #1273, epic #1281). Written in the SAME
  local step that flips a message's `MessageFlag`/`ThreadMessage` read or star
  state — the marker's existence IS the record that the flip still owes IMAP a
  push. A marker clears ONLY on a confirmed IMAP STORE; it is never cleared on
  attempt. References `messageId`, never a UID — the UID (and the message's
  current mailbox) are resolved fresh at push time (epic invariant 1), so the
  marker survives unrelated cursor churn or a placement move of the same
  message.
  
  Keyed per FIELD (`messageId` + `flagName`), not per message alone: a message
  can carry an independent pending read-state marker and a pending star marker
  at the same time, and flipping one must never clobber the other (epic FAQ —
  "a flag flip replaces a pending flag flip", scoped per field). At most one
  pending push exists per (messageId, flagName): a later flip of the SAME
  field replaces the marker (`put`, not `create`), matching "later intent wins
  locally".
  """)
@entity("messageFlagPush", "remit")
@index(
  "MessageFlagPush",
  {
    pk: [MessageFlagPush.messageId],
    sk: [MessageFlagPush.flagName],
  }
)
@doc("List every pending flag push for an account — used ONLY to adjust unseenCount at read time (epic #1281 invariant 4: a prediction, never persisted) and by the account-worker cascade delete. Pending markers are expected to be few and short-lived.")
@index(
  "byAccountId",
  {
    index: "gsi0",
    pk: [MessageFlagPush.accountId],
    sk: [MessageFlagPush.messageId, MessageFlagPush.flagName],
  }
)
@doc("List every pending flag push whose LAST-KNOWN mailbox is this one — the candidate set the periodic per-mailbox sync tick drains using its already-open, already-locked connection (issue #1273). A hint only: the push always re-resolves the message's CURRENT mailbox fresh (epic invariant 1) rather than trusting this denormalized value, so a marker whose message moved mailboxes after the marker was written is still pushed correctly — just not necessarily by THIS mailbox's tick.")
@index(
  "byMailboxId",
  {
    index: "gsi1",
    pk: [MessageFlagPush.mailboxId],
    sk: [MessageFlagPush.messageId, MessageFlagPush.flagName],
  }
)
model MessageFlagPush {
  @doc("The message this pending flag push applies to (our internal id, never a UID).")
  @visibility(Lifecycle.Read)
  messageId: UUID;

  @doc("The flag field this marker owns (an RFC 9051 system flag, e.g. \\Seen or \\Flagged). A plain string, not the MessageFlagValue union used on MessageFlag — ElectroDB requires composite-key attributes to be string/number/boolean/enum, and this field participates in both the primary sort key and the byAccountId/byMailboxId GSI sort keys. Scopes 'later intent wins locally' to this field alone — a pending Seen marker and a pending Flagged marker for the same message are independent.")
  @visibility(Lifecycle.Read)
  flagName: string;

  @doc("Account the message belongs to.")
  @visibility(Lifecycle.Read)
  accountId: UUID;

  @doc("Account config id, for thread/address lookups.")
  @visibility(Lifecycle.Read)
  accountConfigId: UUID;

  @doc("Mailbox the message was in when the flip was decided. A denormalized hint for the periodic drain's byMailboxId index only — the push always re-resolves the message's current mailbox fresh at push time (epic invariant 1), never trusts this field as authoritative.")
  @visibility(Lifecycle.Read)
  mailboxId: UUID;

  @doc("The IMAP flag transition to apply once pushed.")
  @visibility(Lifecycle.Read)
  operation: FlagPushOperation;

  @doc("Explicit state engine (pending -> queued -> processing -> processed). Recovery keys off this field, not control-flow inference — see the enum's own doc.")
  @visibility(Lifecycle.Read)
  state: MessageFlagPushState = MessageFlagPushState.pending;

  @visibility(Lifecycle.Read)
  @createdAt
  createdAt: int64;

  @visibility(Lifecycle.Read)
  @updatedAt
  updatedAt: int64;
}
