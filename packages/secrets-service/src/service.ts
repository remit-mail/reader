import assert from "node:assert";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import {
	DecryptCommand,
	GenerateDataKeyCommand,
	KMSClient,
} from "@aws-sdk/client-kms";
import { expectEnv } from "expect-env";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;
const _AUTH_TAG_LENGTH = 16;

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

export const createSecretsService = (): SecretsService => {
	const kmsKeyId = expectEnv("KMS_KEY_ID");
	const kms = new KMSClient({});

	const encrypt = async (plaintext: string): Promise<EncryptedPayload> => {
		const { Plaintext, CiphertextBlob } = await kms.send(
			new GenerateDataKeyCommand({
				KeyId: kmsKeyId,
				KeySpec: "AES_256",
			}),
		);

		assert(Plaintext, "KMS failed to return Plaintext key");
		assert(CiphertextBlob, "KMS failed to return CiphertextBlob");

		const iv = randomBytes(IV_LENGTH);
		const cipher = createCipheriv(ALGORITHM, Plaintext, iv);

		const encryptedData = Buffer.concat([
			cipher.update(plaintext, "utf8"),
			cipher.final(),
		]);

		return {
			encryptedDek: Buffer.from(CiphertextBlob),
			encryptedData,
			iv,
			authTag: cipher.getAuthTag(),
		};
	};

	const decrypt = async (payload: EncryptedPayload): Promise<string> => {
		const { encryptedDek, encryptedData, iv, authTag } = payload;

		const { Plaintext } = await kms.send(
			new DecryptCommand({ CiphertextBlob: encryptedDek }),
		);

		assert(Plaintext, "KMS failed to return Plaintext key");

		const decipher = createDecipheriv(ALGORITHM, Plaintext, iv);
		decipher.setAuthTag(authTag);

		return Buffer.concat([
			decipher.update(encryptedData),
			decipher.final(),
		]).toString("utf8");
	};

	return { encrypt, decrypt };
};

export const createMockSecretsService = (): SecretsService => ({
	encrypt: async (plaintext: string) => ({
		encryptedDek: Buffer.from("mock"),
		encryptedData: Buffer.from(plaintext),
		iv: Buffer.alloc(12),
		authTag: Buffer.alloc(16),
	}),
	decrypt: async (payload: EncryptedPayload) =>
		payload.encryptedData.toString("utf8"),
});
