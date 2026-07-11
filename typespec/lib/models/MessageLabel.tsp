import "typespec-electrodb-emitter";

namespace RemitImap;

@doc("""
  Junction whose existence *is* a label assignment (RFC 030). Holds only ids
  and is hydrated with `batchGet`. Keyed by a deterministic UUID v5 derived
  from `messageId` + `labelId`, so applying a label is idempotent and a
  single `get` checks whether it is already set.
  """)
@entity("messageLabel", "remit")
@index(
  "MessageLabel",
  {
    pk: [MessageLabel.messageLabelId],
    sk: [],
  }
)
// Labels on a message.
@index(
  "byMessageId",
  {
    index: "gsi1",
    pk: [MessageLabel.messageId],
    sk: [MessageLabel.labelId],
  }
)
// Messages with a label, newest first.
@index(
  "byLabelId",
  {
    index: "gsi2",
    pk: [MessageLabel.accountConfigId],
    sk: [MessageLabel.labelId, MessageLabel.createdAt],
  }
)
model MessageLabel {
  @doc("Deterministic UUID v5 derived from messageId + labelId")
  @visibility(Lifecycle.Read)
  messageLabelId: UUID;

  @doc("Message this label is applied to")
  @visibility(Lifecycle.Read)
  messageId: UUID;

  @doc("Label applied to the message")
  @visibility(Lifecycle.Read)
  labelId: UUID;

  @doc("Owning account configuration, denormalized for byLabelId")
  @visibility(Lifecycle.Read)
  accountConfigId: UUID;

  @doc("Filter that produced this row (RFC 034 Decision 3.3). Absent for a manually-applied label. Best-effort provenance, not a durable foreign key: once a Temporary filter's row is TTL-reaped (RFC 034 Decision 1.3), this id dangles by design — the MessageLabel row itself is unaffected.")
  @visibility(Lifecycle.Read)
  appliedByFilterId?: UUID;

  @visibility(Lifecycle.Read)
  @createdAt
  createdAt: int64;

  @visibility(Lifecycle.Read)
  @updatedAt
  updatedAt: int64;
}
