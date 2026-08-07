import "@typespec/http";

import "../enums/OutboxAttachmentRejectionReason.tsp";
import "../scalars/string.tsp";

using TypeSpec.Http;

namespace RemitImap;

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

@doc("""
  A file that is on the draft: uploaded, and confirmed against storage.
  
  Only what the server can vouch for. The filename and media type came back on
  the mint and are the client's to hold until the outbox row carries them.
  """)
model OutboxAttachmentResponse {
  @doc("Primary identifier")
  outboxAttachmentId: UUID;

  @doc("Draft the file belongs to")
  outboxMessageId: UUID;

  @doc("Size read back from storage, never a number the client supplied")
  @minValue(0)
  sizeBytes: int64;
}

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
