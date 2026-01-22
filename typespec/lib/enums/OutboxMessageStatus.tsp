namespace RemitImap;

@doc("Status of an outbox message in the send queue")
enum OutboxMessageStatus {
  @doc("Message is being composed, not yet queued")
  draft: "draft",

  @doc("Message is queued for sending")
  queued: "queued",

  @doc("Message is currently being sent")
  sending: "sending",

  @doc("Message was successfully sent")
  sent: "sent",

  @doc("Permanent failure - exceeded retries or non-retryable error")
  failed: "failed",
}
