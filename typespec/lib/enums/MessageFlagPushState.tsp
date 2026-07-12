namespace RemitImap;

@doc("Explicit state engine for a pending flag-push marker (issue #1273, epic #1281). Mirrors `MessagePlacementMoveState` (#1271) — recovery keys off this field, not control-flow inference: a redelivered event, or the periodic per-mailbox drain, drives a marker forward from whichever state it is actually in.")
enum MessageFlagPushState {
  @doc("The local flag flip (MessageFlag + ThreadMessage) and the marker itself are durable; the IMAP push has not yet been successfully enqueued as a wake-up hint. Set in the SAME sequential step that creates the marker — before any SQS call. A marker stuck here means the enqueue hint failed or never ran; the periodic per-mailbox drain (or a retried API call) still finds and pushes it, since the marker — not the hint — is the queue.")
  pending: "pending",

  @doc("The SQS wake-up hint was sent. The push is in flight; the reconciler (single-marker handler or the periodic drain) will pick it up.")
  queued: "queued",

  @doc("The push worker has picked up the marker and is actively attempting the IMAP STORE.")
  processing: "processing",

  @doc("Confirmed IMAP acknowledgement. Terminal — the marker is deleted immediately upon reaching this state (epic invariant 4: no lingering row once the flip is no longer pending), so this value is written only transiently, if at all, before the delete.")
  processed: "processed",
}
