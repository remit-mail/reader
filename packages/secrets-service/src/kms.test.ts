import assert from "node:assert/strict";
import { afterEach, describe, it, mock } from "node:test";
import {
	DecryptCommand,
	GenerateDataKeyCommand,
	KMSClient,
} from "@aws-sdk/client-kms";
import { createKmsDataKeyProvider } from "./kms.js";
import {
	createSecretsService,
	deserializeEncryptedPayload,
	serializeEncryptedPayload,
} from "./service.js";

const plaintext = new Uint8Array(32).fill(7);
const ciphertext = new Uint8Array([1, 2, 3]);

const answerAsKms = (answer: (command: object) => object): object[] => {
	const sent: object[] = [];
	mock.method(KMSClient.prototype, "send", async (command: object) => {
		sent.push(command);
		return answer(command);
	});
	return sent;
};

describe("createKmsDataKeyProvider over KMS", () => {
	afterEach(() => mock.restoreAll());

	it("generates an AES-256 data key under the named key", async () => {
		const sent = answerAsKms(() => ({
			Plaintext: plaintext,
			CiphertextBlob: ciphertext,
		}));

		const key = await createKmsDataKeyProvider(
			"arn:aws:kms:eu-west-1:0:key/k",
			new KMSClient({ region: "eu-west-1" }),
		).generateDataKey();

		assert.deepEqual(key, { plaintext, encrypted: ciphertext });
		assert.ok(sent[0] instanceof GenerateDataKeyCommand);
		assert.deepEqual(sent[0].input, {
			KeyId: "arn:aws:kms:eu-west-1:0:key/k",
			KeySpec: "AES_256",
		});
	});

	it("decrypts a data key through KMS", async () => {
		const sent = answerAsKms(() => ({ Plaintext: plaintext }));

		const key = await createKmsDataKeyProvider(
			"arn:aws:kms:eu-west-1:0:key/k",
			new KMSClient({ region: "eu-west-1" }),
		).decryptDataKey(ciphertext);

		assert.deepEqual(key, plaintext);
		assert.ok(sent[0] instanceof DecryptCommand);
	});

	it("refuses a generate answer without the plaintext key", async () => {
		answerAsKms(() => ({ CiphertextBlob: ciphertext }));

		await assert.rejects(
			createKmsDataKeyProvider(
				"arn:aws:kms:eu-west-1:0:key/k",
				new KMSClient({ region: "eu-west-1" }),
			).generateDataKey(),
			/Plaintext/,
		);
	});
});

describe("an encrypted payload stored as text", () => {
	it("reads back as the payload it was written from", async () => {
		const secrets = createSecretsService({
			generateDataKey: async () => ({ plaintext, encrypted: ciphertext }),
			decryptDataKey: async () => plaintext,
		});
		const payload = await secrets.encrypt("app-password");

		const restored = deserializeEncryptedPayload(
			JSON.parse(JSON.stringify(serializeEncryptedPayload(payload))),
		);

		assert.equal(await secrets.decrypt(restored), "app-password");
	});
});
