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
