import assert from "node:assert";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import {
	DecryptCommand,
	GenerateDataKeyCommand,
	KMSClient,
} from "@aws-sdk/client-kms";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;

export interface EncryptedPayload {
	encryptedDek: Buffer;
	encryptedData: Buffer;
	iv: Buffer;
	authTag: Buffer;
}

export interface SecretsService {
	encrypt(plaintext: string): Promise<EncryptedPayload>;
	decrypt(payload: EncryptedPayload): Promise<string>;
}

export interface DataKeyProvider {
	generateDataKey(): Promise<{ plaintext: Uint8Array; encrypted: Uint8Array }>;
	decryptDataKey(encrypted: Uint8Array): Promise<Uint8Array>;
}

interface CacheEntry {
	key: Uint8Array;
	expiresAt: number;
}

export const createCachedDataKeyProvider = (
	provider: DataKeyProvider,
	ttlMs: number = 5 * 60 * 1000,
): DataKeyProvider => {
	const cache = new Map<string, CacheEntry>();

	return {
		generateDataKey: () => provider.generateDataKey(),

		async decryptDataKey(encrypted: Uint8Array) {
			const cacheKey = Buffer.from(encrypted).toString("hex");
			const now = Date.now();

			const cached = cache.get(cacheKey);
			if (cached && cached.expiresAt > now) {
				return cached.key;
			}

			const plaintext = await provider.decryptDataKey(encrypted);

			cache.set(cacheKey, {
				key: plaintext,
				expiresAt: now + ttlMs,
			});

			return plaintext;
		},
	};
};

export const encryptWithKey = (
	plaintext: string,
	key: Uint8Array,
): { encryptedData: Buffer; iv: Buffer; authTag: Buffer } => {
	const iv = randomBytes(IV_LENGTH);
	const cipher = createCipheriv(ALGORITHM, key, iv);

	const encryptedData = Buffer.concat([
		cipher.update(plaintext, "utf8"),
		cipher.final(),
	]);

	return {
		encryptedData,
		iv,
		authTag: cipher.getAuthTag(),
	};
};

export const decryptWithKey = (
	encryptedData: Buffer,
	key: Uint8Array,
	iv: Buffer,
	authTag: Buffer,
): string => {
	const decipher = createDecipheriv(ALGORITHM, key, iv);
	decipher.setAuthTag(authTag);

	return Buffer.concat([
		decipher.update(encryptedData),
		decipher.final(),
	]).toString("utf8");
};

export const createKmsDataKeyProvider = (
	kmsKeyId: string,
	kms: KMSClient = new KMSClient({}),
): DataKeyProvider => ({
	async generateDataKey() {
		const { Plaintext, CiphertextBlob } = await kms.send(
			new GenerateDataKeyCommand({
				KeyId: kmsKeyId,
				KeySpec: "AES_256",
			}),
		);

		assert(Plaintext, "KMS failed to return Plaintext key");
		assert(CiphertextBlob, "KMS failed to return CiphertextBlob");

		return { plaintext: Plaintext, encrypted: CiphertextBlob };
	},

	async decryptDataKey(encrypted: Uint8Array) {
		const { Plaintext } = await kms.send(
			new DecryptCommand({ CiphertextBlob: encrypted }),
		);

		assert(Plaintext, "KMS failed to return Plaintext key");
		return Plaintext;
	},
});

export const createSecretsService = (
	dataKeyProvider: DataKeyProvider,
): SecretsService => ({
	async encrypt(plaintext: string): Promise<EncryptedPayload> {
		const { plaintext: key, encrypted: encryptedDek } =
			await dataKeyProvider.generateDataKey();

		const { encryptedData, iv, authTag } = encryptWithKey(plaintext, key);

		return {
			encryptedDek: Buffer.from(encryptedDek),
			encryptedData,
			iv,
			authTag,
		};
	},

	async decrypt(payload: EncryptedPayload): Promise<string> {
		const { encryptedDek, encryptedData, iv, authTag } = payload;

		const key = await dataKeyProvider.decryptDataKey(encryptedDek);

		return decryptWithKey(encryptedData, key, iv, authTag);
	},
});
