import "@typespec/http";

import "../enums/OutboxAttachmentRejectionReason.tsp";
import "../scalars/string.tsp";

using TypeSpec.Http;

namespace RemitImap;

@doc("A file stored against a draft outbox message")
model OutboxAttachmentResponse {
  @doc("Primary identifier")
  outboxAttachmentId: UUID;

  @doc("Draft the file belongs to")
  outboxMessageId: UUID;

  @doc("Filename as it will appear on the sent message, sanitized server-side")
  filename: String256;

  @doc("Media type recorded at upload. Never trusted for rendering.")
  contentType: String256;

  @doc("Size of the stored bytes")
  @minValue(0)
  sizeBytes: int64;

  @doc("SHA-256 of the stored bytes")
  @minLength(64)
  @maxLength(64)
  checksumSha256: string;
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

  @doc("Bytes already stored against this draft")
  @minValue(0)
  usedBytes: int64;
}

@doc("Refusal response for an upload")
model OutboxAttachmentRejected {
  @statusCode statusCode: 400 | 413;
  @body error: OutboxAttachmentRejection;
}

@doc("The file part of an attachment upload")
model OutboxAttachmentUpload {
  @doc("The file bytes, its filename and its media type")
  file: HttpPart<File>;
}
