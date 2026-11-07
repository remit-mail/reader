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

  @doc("May have been delivered but is not filed in the Sent mailbox: the account has no Sent folder, or the connection dropped after the message was written. Never re-sent on its own; the user can edit and send it again.")
  unfiled: "unfiled",

  @doc("Permanent failure - exceeded retries or non-retryable error")
  failed: "failed",

  @doc("Cannot be sent until account is reconfigured (e.g. SMTP not configured). Distinct from `failed` — no auto-retry, requires user action.")
  blocked: "blocked",
}
