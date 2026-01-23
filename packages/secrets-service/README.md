# @remit/secrets-service

Service for encrypting and decrypting sensitive data (primarily IMAP passwords) using AWS KMS envelope encryption.

## Features

- **Envelope Encryption**: Uses KMS to generate Data Encryption Keys (DEKs), and performs AES-256-GCM encryption locally.
- **Cost Effective**: Minimizes KMS API calls by handling bulk encryption locally.
- **Secure**: Uses authenticated encryption (GCM) to ensure data integrity.

## Installation

```bash
npm install @remit/secrets-service
```

## Usage

```typescript
import { createSecretsService } from "@remit/secrets-service";

const secrets = createSecretsService();

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

For local testing, you can use the mock service which does not require AWS credentials:

```typescript
import { createMockSecretsService } from "@remit/secrets-service";

const secrets = createMockSecretsService();
```
