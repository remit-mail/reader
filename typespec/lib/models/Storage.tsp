import "typespec-electrodb-emitter";

import "../enums/StorageType.tsp";
import "../enums/ContentEncoding.tsp";
import "../scalars/string.tsp";

namespace RemitImap;

@doc("Reference to the complete raw message stored externally")
@entity("rawMessageStorage", "remit")
@index(
  "RawMessageStorage",
  {
    pk: [RawMessageStorage.rawStorageId],
    sk: [],
  }
)
@index(
  "byMessageId",
  {
    collection: "messageData",
    index: "gsi2",
    pk: [RawMessageStorage.messageId],
    sk: [RawMessageStorage.rawStorageId],
  }
)
model RawMessageStorage {
  @doc("Primary identifier")
  @visibility(Lifecycle.Read)
  rawStorageId: UUID;

  @doc("Reference to parent message")
  @visibility(Lifecycle.Read)
  messageId: UUID;

  @doc("Storage backend type")
  @visibility(Lifecycle.Read)
  storageType: StorageType;

  @doc("Storage location (bucket name or filesystem path)")
  @visibility(Lifecycle.Read)
  storageLocation: string;

  @doc("Unique key within the storage system")
  @visibility(Lifecycle.Read)
  storageKey: string;

  @doc("Size in bytes")
  @visibility(Lifecycle.Read)
  @minValue(0)
  sizeBytes: int64;

  @doc("SHA-256 checksum for integrity verification")
  @visibility(Lifecycle.Read)
  @minLength(64)
  @maxLength(64)
  checksumSha256: string;

  @doc("Compression applied to stored content")
  @visibility(Lifecycle.Read)
  contentEncoding: ContentEncoding;

  @doc("When the content was stored")
  @visibility(Lifecycle.Read)
  storedAt: int64;

  @doc("Optional expiration for retention policies")
  @visibility(Lifecycle.Read)
  expiresAt?: int64;

  @visibility(Lifecycle.Read)
  @createdAt
  createdAt: int64;

  @visibility(Lifecycle.Read)
  @updatedAt
  updatedAt: int64;
}

@doc("Reference to individual body part content stored externally. Supports deduplication for attachments.")
@entity("bodyPartStorage", "remit")
@index(
  "BodyPartStorage",
  {
    pk: [BodyPartStorage.bodyPartStorageId],
    sk: [],
  }
)
@index(
  "byMessageId",
  {
    collection: "messageData",
    index: "gsi2",
    pk: [BodyPartStorage.messageId],
    sk: [BodyPartStorage.bodyPartStorageId],
  }
)
model BodyPartStorage {
  @doc("Primary identifier")
  @visibility(Lifecycle.Read)
  bodyPartStorageId: UUID;

  @doc("Reference to parent message")
  @visibility(Lifecycle.Read)
  messageId: UUID;

  @doc("Reference to parent body part")
  @visibility(Lifecycle.Read)
  bodyPartId: UUID;

  @doc("Storage backend type")
  @visibility(Lifecycle.Read)
  storageType: StorageType;

  @doc("Storage location (bucket name or filesystem path)")
  @visibility(Lifecycle.Read)
  storageLocation: string;

  @doc("Unique key within the storage system")
  @visibility(Lifecycle.Read)
  storageKey: string;

  @doc("Size in bytes after transfer encoding is removed")
  @visibility(Lifecycle.Read)
  @minValue(0)
  decodedSizeBytes: int64;

  @doc("SHA-256 checksum for integrity verification")
  @visibility(Lifecycle.Read)
  @minLength(64)
  @maxLength(64)
  checksumSha256: string;

  @doc("Additional compression applied to stored content")
  @visibility(Lifecycle.Read)
  contentEncoding: ContentEncoding;

  @doc("True if content-addressed storage is used for deduplication")
  @visibility(Lifecycle.Read)
  isDeduped: boolean;

  @doc("Hash for deduplication lookups (content-addressable key)")
  @visibility(Lifecycle.Read)
  dedupHash?: string;

  @doc("When the content was stored")
  @visibility(Lifecycle.Read)
  storedAt: int64;

  @visibility(Lifecycle.Read)
  @createdAt
  createdAt: int64;

  @visibility(Lifecycle.Read)
  @updatedAt
  updatedAt: int64;
}

@doc("Inline storage for small body parts (typically < 64KB). Avoids external storage overhead.")
@entity("bodyPartContent", "remit")
@index(
  "BodyPartContent",
  {
    pk: [BodyPartContent.bodyPartContentId],
    sk: [],
  }
)
@index(
  "byMessageId",
  {
    collection: "messageData",
    index: "gsi2",
    pk: [BodyPartContent.messageId],
    sk: [BodyPartContent.bodyPartContentId],
  }
)
model BodyPartContent {
  @doc("Primary identifier")
  @visibility(Lifecycle.Read)
  bodyPartContentId: UUID;

  @doc("Reference to parent message")
  @visibility(Lifecycle.Read)
  messageId: UUID;

  @doc("Reference to parent body part")
  @visibility(Lifecycle.Read)
  bodyPartId: UUID;

  @doc("The actual content (for small inline content only)")
  @visibility(Lifecycle.Read)
  content: string;

  @doc("Content length in bytes")
  @visibility(Lifecycle.Read)
  @minValue(0)
  contentLength: int64;

  @visibility(Lifecycle.Read)
  @createdAt
  createdAt: int64;

  @visibility(Lifecycle.Read)
  @updatedAt
  updatedAt: int64;
}
