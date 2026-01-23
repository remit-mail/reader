# @remit/secrets-service

Service for encrypting and decrypting sensitive data (primarily IMAP passwords) using AWS KMS envelope encryption.

## Features

- **Envelope Encryption**: Uses KMS to generate Data Encryption Keys (DEKs), and performs AES-256-GCM encryption locally.
- **Cost Effective**: Minimizes KMS API calls by handling bulk encryption locally.
- **Secure**: Uses authenticated encryption (GCM) to ensure data integrity.
- **Testable**: Dependency injection allows testing without AWS credentials.

## Installation

```bash
npm install @remit/secrets-service
```

## Usage

```typescript
import {
    createSecretsService,
    createKmsDataKeyProvider,
} from "@remit/secrets-service";

const dataKeyProvider = createKmsDataKeyProvider(process.env.KMS_KEY_ID!);
const secrets = createSecretsService(dataKeyProvider);

// Encrypting a value
const encrypted = await secrets.encrypt("my-secret-password");
// Returns: { encryptedDek, encryptedData, iv, authTag } (all Buffers)

// Decrypting a value
const plaintext = await secrets.decrypt(encrypted);
// Returns: "my-secret-password"
```

## Environment Variables

| Variable     | Required | Description                                                |
| ------------ | -------- | ---------------------------------------------------------- |
| `KMS_KEY_ID` | Yes      | The AWS KMS Key ID or ARN to use for generating data keys. |
| `AWS_REGION` | Yes      | The AWS region where the KMS key exists.                   |

## Testing

For unit tests, inject a mock `DataKeyProvider`:

```typescript
import { createSecretsService, type DataKeyProvider } from "@remit/secrets-service";
import { randomBytes } from "node:crypto";

const mockProvider: DataKeyProvider = {
    async generateDataKey() {
        const key = randomBytes(32);
        return { plaintext: key, encrypted: key };
    },
    async decryptDataKey(encrypted) {
        return encrypted;
    },
};

const secrets = createSecretsService(mockProvider);
```
