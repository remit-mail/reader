import assert from "node:assert";
import { randomBytes } from "node:crypto";
import { test } from "node:test";
import {
	createSecretsService,
	type DataKeyProvider,
	decryptWithKey,
	encryptWithKey,
} from "./service.js";

test("encryptWithKey/decryptWithKey round-trips correctly", () => {
	const key = randomBytes(32);
	const plaintext = "super-secret-password";

	const { encryptedData, iv, authTag } = encryptWithKey(plaintext, key);

	assert.notStrictEqual(
		encryptedData.toString("utf8"),
		plaintext,
		"data should be encrypted",
	);

	const decrypted = decryptWithKey(encryptedData, key, iv, authTag);
	assert.strictEqual(decrypted, plaintext);
});

test("decryptWithKey fails with wrong key", () => {
	const key = randomBytes(32);
	const wrongKey = randomBytes(32);
	const plaintext = "super-secret-password";

	const { encryptedData, iv, authTag } = encryptWithKey(plaintext, key);

	assert.throws(() => {
		decryptWithKey(encryptedData, wrongKey, iv, authTag);
	});
});

test("decryptWithKey fails with tampered auth tag", () => {
	const key = randomBytes(32);
	const plaintext = "super-secret-password";

	const { encryptedData, iv, authTag } = encryptWithKey(plaintext, key);

	authTag[0] ^= 0xff;

	assert.throws(() => {
		decryptWithKey(encryptedData, key, iv, authTag);
	});
});

test("createSecretsService encrypts and decrypts using data key provider", async () => {
	const dataKey = randomBytes(32);
	const encryptedKey = randomBytes(32);

	const mockProvider: DataKeyProvider = {
		async generateDataKey() {
			return { plaintext: dataKey, encrypted: encryptedKey };
		},
		async decryptDataKey(encrypted: Uint8Array) {
			assert.deepStrictEqual(
				Buffer.from(encrypted),
				encryptedKey,
				"should pass through encrypted DEK",
			);
			return dataKey;
		},
	};

	const secrets = createSecretsService(mockProvider);
	const plaintext = "super-secret-password";

	const encrypted = await secrets.encrypt(plaintext);

	assert.deepStrictEqual(encrypted.encryptedDek, encryptedKey);
	assert.notStrictEqual(
		encrypted.encryptedData.toString("utf8"),
		plaintext,
		"data should be encrypted",
	);

	const decrypted = await secrets.decrypt(encrypted);
	assert.strictEqual(decrypted, plaintext);
});
