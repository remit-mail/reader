import assert from "node:assert";
import { createHash } from "node:crypto";
import {
	DecryptCommand,
	GenerateDataKeyCommand,
	KMSClient,
} from "@aws-sdk/client-kms";
import { logger } from "@remit/logger";
import type { DataKeyProvider } from "./service.js";

export const FAKE_KMS_KEY_ID = "FAKE_KMS_KEY_ID";

const getFakeDataKey = (): Buffer => {
	const dataKey = process.env.FAKE_KMS_DATAKEY;
	if (!dataKey) {
		throw new Error(
			"FAKE_KMS_DATAKEY environment variable is required when using FAKE_KMS_KEY_ID",
		);
	}
	return createHash("sha256").update(dataKey).digest();
};

const createFakeDataKeyProvider = (): DataKeyProvider => ({
	async generateDataKey() {
		// `error`, not `warn`: this is a security-posture statement about the key
		// protecting every stored credential, and at `warn` an operator setting
		// LOG_LEVEL=error turns it off without meaning to.
		logger.error("Using the fake KMS data key provider; not for production");
		const plaintext = getFakeDataKey();

		const encrypted = Buffer.concat([Buffer.from("FAKE:"), plaintext]);

		return { plaintext, encrypted };
	},

	async decryptDataKey(encrypted: Uint8Array) {
		// `error`, not `warn`: this is a security-posture statement about the key
		// protecting every stored credential, and at `warn` an operator setting
		// LOG_LEVEL=error turns it off without meaning to.
		logger.error("Using the fake KMS data key provider; not for production");
		const buf = Buffer.from(encrypted);

		const prefix = buf.subarray(0, 5).toString();
		if (prefix !== "FAKE:") {
			throw new Error("Invalid encrypted data key format for fake provider");
		}

		return buf.subarray(5);
	},
});

export const createKmsDataKeyProvider = (
	kmsKeyId: string,
	kms: KMSClient = new KMSClient({}),
): DataKeyProvider => {
	if (kmsKeyId === FAKE_KMS_KEY_ID) {
		return createFakeDataKeyProvider();
	}

	return {
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
	};
};
