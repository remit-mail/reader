# @remit/storage-service

Abstract storage service for email body parts and raw message content. Provides a unified interface for storing and retrieving binary content with configurable backends (S3 or local filesystem).

## Installation

```bash
npm install -w packages/storage-service
```

## Quick Start

```typescript
import { createStorageService } from "@remit/storage-service";
import { ContentEncoding } from "@remit/domain-enums";

const storage = createStorageService();

// Store content
const ref = await storage.store(Buffer.from("Hello, world!"), {
  key: "accounts/abc123/messages/def456/body",
  contentEncoding: ContentEncoding.Gzip,
  contentType: "text/plain; charset=utf-8",
});

// Retrieve content
const content = await storage.retrieve(ref.uri);

// Check existence
if (await storage.exists(ref.uri)) {
  await storage.delete(ref.uri);
}
```

## Environment Variables

| Variable             | Required | Description                                  |
| -------------------- | -------- | -------------------------------------------- |
| `S3_BUCKET_NAME`     | No       | S3 bucket name. If set, S3 backend is used   |
| `S3_ENDPOINT`        | No       | Custom S3 endpoint (for LocalStack/MinIO)    |
| `STORAGE_LOCAL_PATH` | No       | Local filesystem path. Default: `.remit/storage` |

### Backend Selection

The factory function automatically selects the backend:

```
if (S3_BUCKET_NAME is defined) → S3 backend
else → Filesystem backend
```

## API

### StorageService

```typescript
interface StorageService {
  store(content: Buffer, options: StoreOptions): Promise<StorageReference>;
  retrieve(uri: string): Promise<Buffer>;
  exists(uri: string): Promise<boolean>;
  delete(uri: string): Promise<void>;
  contentAddressableKey(content: Buffer, prefix?: string): string;
}
```

### StoreOptions

```typescript
interface StoreOptions {
  key: string; // Storage path
  contentEncoding?: ContentEncoding; // Compression (default: none)
  contentType?: string; // MIME type for S3 metadata
  contentAddressable?: boolean; // Use content hash as key
}
```

### StorageReference

Returned by `store()`, contains all information needed to retrieve or reference the stored content:

```typescript
interface StorageReference {
  uri: string; // Full URI: s3://bucket/key or file:///path
  storageType: StorageTypeValue; // "s3" | "filesystem"
  storageLocation: string; // Bucket name or base path
  storageKey: string; // Object key or relative path
  sizeBytes: number; // Size after compression
  checksumSha256: string; // Hex-encoded SHA-256 of original content
  contentEncoding: ContentEncoding;
}
```

## URI Format

Storage references use URIs that encode all information needed to retrieve content:

```
s3://bucket-name/path/to/object
file:///var/data/remit/path/to/file
```

### URI Utilities

```typescript
import { parseStorageUri, buildStorageUri } from "@remit/storage-service";
import { StorageType } from "@remit/domain-enums";

// Parse URI into components
const parsed = parseStorageUri("s3://my-bucket/path/to/object");
// { storageType: "s3", storageLocation: "my-bucket", storageKey: "path/to/object" }

// Build URI from components
const uri = buildStorageUri(StorageType.S3, "my-bucket", "path/to/object");
// "s3://my-bucket/path/to/object"
```

## Content-Addressable Storage

For deduplication of attachments that may appear in multiple messages:

```typescript
const storage = createStorageService();
const attachmentBuffer = Buffer.from(/* ... */);

// Generate content-addressable key
const key = storage.contentAddressableKey(attachmentBuffer);
// "dedup/a3/a3f2b8c9d0e1f2..."

// Check if already stored
const dedupUri = `s3://${bucketName}/${key}`;
if (await storage.exists(dedupUri)) {
  // Content already stored, just reference it
  return { uri: dedupUri, isDeduped: true };
}

// Store with content-addressable key
const ref = await storage.store(attachmentBuffer, {
  key: "ignored-when-content-addressable",
  contentAddressable: true,
});
```

## Compression

Gzip compression is automatically handled:

```typescript
// Store with compression
const ref = await storage.store(content, {
  key: "messages/123/body",
  contentEncoding: ContentEncoding.Gzip,
});

// Retrieve automatically decompresses
const original = await storage.retrieve(ref.uri);
```

## Using Specific Backends

For cases where you need direct access to a specific backend:

```typescript
import {
  createS3StorageService,
  createFilesystemStorageService,
} from "@remit/storage-service";
import { S3Client } from "@aws-sdk/client-s3";

// S3 backend
const s3Client = new S3Client({ endpoint: "http://localhost:4566" });
const s3Storage = createS3StorageService(s3Client, "my-bucket");

// Filesystem backend
const fsStorage = createFilesystemStorageService("/var/data/remit");
```

## Testing

### Mock Service

For unit tests, use the mock implementation:

```typescript
import { createMockStorageService } from "@remit/storage-service";

const storage = createMockStorageService();

// Works like the real service but stores in memory
const ref = await storage.store(Buffer.from("test"), { key: "test.txt" });
const content = await storage.retrieve(ref.uri);
```

### Running Tests

```bash
# Run package tests
npm test -w packages/storage-service

# With LocalStack for S3 tests
S3_BUCKET_NAME=test-bucket S3_ENDPOINT=http://localhost:4566 npm test -w packages/storage-service
```

## Key Path Conventions

Consistent key paths enable efficient listing and cleanup:

```
accounts/{accountId}/
  messages/{messageId}/
    raw                          # Raw RFC822 message
    parts/
      {partPath}                 # Body part content (1, 1.1, 2.1.3, etc.)

dedup/
  {hash[0:2]}/
    {hash}                       # Content-addressable storage for attachments
```

## Integration with ElectroDB Entities

```typescript
import { BodyPartStorageService } from "@remit/remit-electrodb-service";
import { createStorageService } from "@remit/storage-service";

const storage = createStorageService();
const bodyPartStorageService = new BodyPartStorageService(config);

// Store content and create entity reference
const ref = await storage.store(content, {
  key: `messages/${messageId}/parts/${partPath}`,
  contentEncoding: ContentEncoding.Gzip,
});

await bodyPartStorageService.create({
  messageId,
  bodyPartId,
  storageType: ref.storageType,
  storageLocation: ref.storageLocation,
  storageKey: ref.storageKey,
  decodedSizeBytes: content.length,
  checksumSha256: ref.checksumSha256,
  contentEncoding: ref.contentEncoding,
  isDeduped: false,
  storedAt: Date.now(),
});
```

## Exports

```typescript
// Factory functions
export { createStorageService, createMockStorageService } from "./storage.js";
export { createFilesystemStorageService } from "./backends/filesystem.js";
export { createS3StorageService } from "./backends/s3.js";

// URI utilities
export { parseStorageUri, buildStorageUri } from "./uri.js";

// Types
export type {
  StorageService,
  StorageReference,
  StoreOptions,
} from "./storage.js";
export type { StorageTypeValue, ContentEncodingValue } from "./storage.js";
export type { ParsedStorageUri } from "./uri.js";
```
