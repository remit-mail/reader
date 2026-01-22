import "typespec-electrodb-emitter";

import "../enums/OutboxMessageStatus.tsp";
import "../scalars/string.tsp";

namespace RemitImap;

@doc("Outbound message queued for sending via SMTP")
@entity("outboxMessage", "remit")
@index(
  "OutboxMessage",
  {
    pk: [OutboxMessage.outboxMessageId],
    sk: [],
  }
)
@index(
  "byAccountId",
  {
    index: "gsi0",
    pk: [OutboxMessage.accountId],
    sk: [OutboxMessage.createdAt],
  }
)
model OutboxMessage {
  @doc("Primary identifier")
  @visibility(Lifecycle.Read)
  outboxMessageId: UUID;

  @doc("Reference to sending account")
  @visibility(Lifecycle.Read)
  accountId: UUID;

  @doc("Reference to account config")
  @visibility(Lifecycle.Read)
  accountConfigId: UUID;

  // ============================================
  // Envelope (SMTP MAIL FROM / RCPT TO)
  // ============================================

  @doc("Sender address for MAIL FROM (bounce address)")
  @visibility(Lifecycle.Read)
  fromAddress: string;

  @doc("Display name for From header")
  @visibility(Lifecycle.Read)
  fromName?: string;

  @doc("Recipient addresses (To)")
  @visibility(Lifecycle.Read)
  toAddresses: string[];

  @doc("CC recipient addresses")
  @visibility(Lifecycle.Read)
  ccAddresses?: string[];

  @doc("BCC recipient addresses")
  @visibility(Lifecycle.Read)
  bccAddresses?: string[];

  @doc("Reply-To address if different from From")
  @visibility(Lifecycle.Read)
  replyToAddress?: string;

  // ============================================
  // Headers
  // ============================================

  @doc("Subject line")
  @visibility(Lifecycle.Read)
  subject?: string;

  @doc("Generated Message-ID (stored without angle brackets)")
  @visibility(Lifecycle.Read)
  messageIdValue: string;

  @doc("In-Reply-To header value (parent message-id, without brackets)")
  @visibility(Lifecycle.Read)
  inReplyTo?: string;

  @doc("References header values (array of message-ids, without brackets)")
  @visibility(Lifecycle.Read)
  references?: string[];

  // ============================================
  // Content
  // ============================================

  @doc("Plain text body")
  @visibility(Lifecycle.Read)
  textBody?: string;

  @doc("HTML body")
  @visibility(Lifecycle.Read)
  htmlBody?: string;

  // ============================================
  // Status
  // ============================================

  @doc("Current send status")
  @visibility(Lifecycle.Read)
  status: OutboxMessageStatus;

  @doc("Last error message if status is failed")
  @visibility(Lifecycle.Read)
  lastError?: string;

  @doc("SMTP response code from last attempt")
  @visibility(Lifecycle.Read)
  lastSmtpCode?: int32;

  @doc("Timestamp when message was successfully sent")
  @visibility(Lifecycle.Read)
  sentAt?: int64;

  @doc("SMTP server's Message-ID response (if different)")
  @visibility(Lifecycle.Read)
  smtpMessageId?: string;

  @visibility(Lifecycle.Read)
  @createdAt
  createdAt: int64;

  @visibility(Lifecycle.Read)
  @updatedAt
  updatedAt: int64;
}
