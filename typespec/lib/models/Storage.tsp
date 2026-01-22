import "../enums/StorageType.tsp";
import "../enums/ContentEncoding.tsp";

namespace RemitImap;

@doc("Reference to the complete raw message stored externally")
model RawMessageStorage {
  @doc("Primary identifier")
  rawStorageId: string;

  @doc("Reference to parent message")
  messageId: string;

  @doc("Storage backend type")
  storageType: StorageType;

  @doc("Storage location (bucket name or filesystem path)")
  storageLocation: string;

  @doc("Unique key within the storage system")
  storageKey: string;

  @doc("Size in bytes")
  @minValue(0)
  sizeBytes: int64;

  @doc("SHA-256 checksum for integrity verification")
  @minLength(64)
  @maxLength(64)
  checksumSha256: string;

  @doc("Compression applied to stored content")
  contentEncoding: ContentEncoding;

  @doc("When the content was stored")
  storedAt: utcDateTime;

  @doc("Optional expiration for retention policies")
  expiresAt?: utcDateTime;
}

@doc("Reference to individual body part content stored externally. Supports deduplication for attachments sent to multiple recipients.")
model BodyPartStorage {
  @doc("Primary identifier")
  bodyPartStorageId: string;

  @doc("Reference to parent body part")
  bodyPartId: string;

  @doc("Storage backend type")
  storageType: StorageType;

  @doc("Storage location (bucket name or filesystem path)")
  storageLocation: string;

  @doc("Unique key within the storage system")
  storageKey: string;

  @doc("Size in bytes after transfer encoding is removed")
  @minValue(0)
  decodedSizeBytes: int64;

  @doc("SHA-256 checksum for integrity verification")
  @minLength(64)
  @maxLength(64)
  checksumSha256: string;

  @doc("Additional compression applied to stored content")
  contentEncoding: ContentEncoding;

  @doc("True if content-addressed storage is used for deduplication")
  isDeduped: boolean;

  @doc("Hash for deduplication lookups (content-addressable key)")
  dedupHash?: string;

  @doc("When the content was stored")
  storedAt: utcDateTime;
}

@doc("Inline storage for small body parts (typically < 64KB). Avoids external storage overhead for small text parts.")
model BodyPartContent {
  @doc("Primary identifier")
  bodyPartContentId: string;

  @doc("Reference to parent body part")
  bodyPartId: string;

  @doc("The actual content (for small inline content only)")
  content: string;

  @doc("Content length in bytes")
  @minValue(0)
  contentLength: int64;
}
