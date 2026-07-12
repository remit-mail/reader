namespace RemitImap;

@doc("Explicit state engine for a pending placement-move marker (issue #1271, epic #1281). Recovery keys off this field, not control-flow inference: a redelivered/retried call drives a marker forward from whichever state it is actually in, rather than re-deriving intent by comparing the message's current location.")
enum MessagePlacementMoveState {
  @doc("Local move (Message + ThreadMessage) and the marker itself are durable; the IMAP push has not yet been successfully enqueued. Set in the SAME sequential step that creates the marker — before any SQS call. A marker stuck here means the enqueue failed or never ran; a retry drives it forward by enqueuing (never by re-deriving the local move, which already happened).")
  pending: "pending",

  @doc("The SQS enqueue succeeded. The push is in flight; the reconciler will pick it up.")
  queued: "queued",

  @doc("The push worker has picked up the event and is actively attempting the IMAP MOVE (and, on an unconfirmed result, the verification probes).")
  processing: "processing",

  @doc("Confirmed IMAP acknowledgement. Terminal — the marker is deleted immediately upon reaching this state (epic invariant 4: no lingering row once the move is no longer pending), so this value is written only transiently, if at all, before the delete.")
  processed: "processed",
}
