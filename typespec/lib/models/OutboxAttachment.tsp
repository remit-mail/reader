import "@typespec/http";
import "typespec-electrodb-emitter";

import "../enums/OutboxAttachmentRejectionReason.tsp";
import "../enums/OutboxAttachmentState.tsp";
import "../scalars/string.tsp";

using TypeSpec.Http;

namespace RemitImap;

@doc("""
  A file on a draft, from the moment room is claimed for it.
  
  The row is the record: it is what the per-message cap is counted over, what
  says an object in storage belongs to a message, and what goes when the draft
  goes. Storage holds bytes and nothing else — an object no row names is
  garbage, which is the only thing the sweep needs to know.
  """)
@entity("outboxAttachment", "remit")
@index(
  "OutboxAttachment",
  {
    pk: [OutboxAttachment.outboxAttachmentId],
    sk: [],
  }
)
@index(
  "byOutboxMessageId",
  {
    index: "gsi0",
    pk: [OutboxAttachment.outboxMessageId],
    sk: [OutboxAttachment.createdAt],
  }
)
model OutboxAttachment {
  @doc("Primary identifier")
  @visibility(Lifecycle.Read)
  outboxAttachmentId: UUID;

  @doc("Draft this file belongs to")
  @visibility(Lifecycle.Read)
  outboxMessageId: UUID;

  @doc("Sending account, so the storage key can be rebuilt without a join")
  @visibility(Lifecycle.Read)
  accountId: UUID;

  @doc("Tenant scope, so every read can be scoped without a join")
  @visibility(Lifecycle.Read)
  accountConfigId: UUID;

  @doc("Filename as it will appear on the sent message, sanitized server-side")
  @visibility(Lifecycle.Read)
  filename: String256;

  @doc("Media type recorded at upload. Never trusted for rendering.")
  @visibility(Lifecycle.Read)
  contentType: String256;

  @doc("Bytes claimed at reservation, confirmed against storage once stored")
  @visibility(Lifecycle.Read)
  @minValue(0)
  sizeBytes: int64;

  @doc("Whether the bytes have arrived")
  @visibility(Lifecycle.Read)
  state: OutboxAttachmentState;

  @doc("Where the bytes live. Written at reservation so nothing has to derive it.")
  @visibility(Lifecycle.Read)
  storageKey: String2048;

  @doc("When a Pending reservation stops holding room. Zero once Stored.")
  @visibility(Lifecycle.Read)
  @minValue(0)
  reservationExpiresAt: int64;

  @visibility(Lifecycle.Read)
  @createdAt
  createdAt: int64;

  @visibility(Lifecycle.Read)
  @updatedAt
  updatedAt: int64;
}

@doc("What the client intends to attach, before any bytes move")
model MintOutboxAttachmentInput {
  @doc("Filename as the sender picked it. Sanitized server-side.")
  filename: String256;

  @doc("Media type the browser reported. Recorded, never trusted for rendering.")
  contentType: String256;

  @doc("Exact size of the file. The upload is bound to this number.")
  @minValue(1)
  sizeBytes: int64;
}

@doc("""
  A reservation and somewhere to put the bytes.
  
  `uploadUrl` is opaque: on a hosted deployment it addresses block storage
  directly and the bytes never traverse this API, on a self-hosted one it
  addresses this deployment's own upload route. A client PUTs the file to it
  either way and cannot tell which it received.
  """)
model MintOutboxAttachmentResponse {
  @doc("Primary identifier, and the name the completion call uses")
  outboxAttachmentId: UUID;

  @doc("Draft the file is reserved against")
  outboxMessageId: UUID;

  @doc("Sanitized filename that will appear on the sent message")
  filename: String256;

  @doc("Normalized media type")
  contentType: String256;

  @doc("Reserved size. The upload must carry exactly this many bytes.")
  @minValue(1)
  sizeBytes: int64;

  @doc("Where to PUT the raw bytes. Single use, one attachment, expires.")
  uploadUrl: String2048;

  @doc("When the reservation and the upload URL both lapse")
  uploadExpiresAt: int64;
}

@doc("A file on a draft, as the composer sees it")
model OutboxAttachmentResponse
  is PickProperties<
    OutboxAttachment,

      | "outboxAttachmentId"
      | "outboxMessageId"
      | "filename"
      | "contentType"
      | "sizeBytes"
      | "state"
  >;

@doc("A file the server refused, with everything the composer needs to say why")
model OutboxAttachmentRejection {
  @doc("Machine-readable reason")
  reason: OutboxAttachmentRejectionReason;

  @doc("Sentence naming the file, its size and the cap")
  message: String512;

  @doc("Total bytes one message may carry")
  @minValue(0)
  limitBytes: int64;

  @doc("Bytes already spoken for on this draft, uploaded or merely reserved")
  @minValue(0)
  usedBytes: int64;
}

@doc("Refusal response for an attachment")
model OutboxAttachmentRejected {
  @statusCode statusCode: 400 | 413;
  @body error: OutboxAttachmentRejection;
}
