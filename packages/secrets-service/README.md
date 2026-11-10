# @remit/secrets-service

Envelope encryption for stored credentials. `createSecretsService` encrypts locally with AES-256-GCM under a data key from a `DataKeyProvider`. `@remit/secrets-service/kms` holds the KMS provider; given the key id `FAKE_KMS_KEY_ID` it derives the data key from `FAKE_KMS_DATAKEY` instead, which is what the self-host stack runs.
