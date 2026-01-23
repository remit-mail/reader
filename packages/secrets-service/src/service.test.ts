import assert from "node:assert";
import { randomBytes } from "node:crypto";
import { test } from "node:test";
import {
	createCachedDataKeyProvider,
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

test("createCachedDataKeyProvider caches decrypted keys", async () => {
	const dataKey = randomBytes(32);
	const encryptedKey = randomBytes(32);
	let decryptCallCount = 0;

	const mockProvider: DataKeyProvider = {
		async generateDataKey() {
			return { plaintext: dataKey, encrypted: encryptedKey };
		},
		async decryptDataKey() {
			decryptCallCount++;
			return dataKey;
		},
	};

	const cachedProvider = createCachedDataKeyProvider(mockProvider);

	const result1 = await cachedProvider.decryptDataKey(encryptedKey);
	const result2 = await cachedProvider.decryptDataKey(encryptedKey);
	const result3 = await cachedProvider.decryptDataKey(encryptedKey);

	assert.strictEqual(decryptCallCount, 1, "should only call provider once");
	assert.deepStrictEqual(result1, dataKey);
	assert.deepStrictEqual(result2, dataKey);
	assert.deepStrictEqual(result3, dataKey);
});

test("createCachedDataKeyProvider caches different keys separately", async () => {
	const dataKey1 = randomBytes(32);
	const dataKey2 = randomBytes(32);
	const encryptedKey1 = randomBytes(32);
	const encryptedKey2 = randomBytes(32);

	const mockProvider: DataKeyProvider = {
		async generateDataKey() {
			return { plaintext: dataKey1, encrypted: encryptedKey1 };
		},
		async decryptDataKey(encrypted: Uint8Array) {
			const key = Buffer.from(encrypted).toString("hex");
			if (key === encryptedKey1.toString("hex")) return dataKey1;
			if (key === encryptedKey2.toString("hex")) return dataKey2;
			throw new Error("Unknown key");
		},
	};

	const cachedProvider = createCachedDataKeyProvider(mockProvider);

	const result1 = await cachedProvider.decryptDataKey(encryptedKey1);
	const result2 = await cachedProvider.decryptDataKey(encryptedKey2);

	assert.deepStrictEqual(result1, dataKey1);
	assert.deepStrictEqual(result2, dataKey2);
});

test("createCachedDataKeyProvider respects TTL expiration", async () => {
	const dataKey = randomBytes(32);
	const encryptedKey = randomBytes(32);
	let decryptCallCount = 0;

	const mockProvider: DataKeyProvider = {
		async generateDataKey() {
			return { plaintext: dataKey, encrypted: encryptedKey };
		},
		async decryptDataKey() {
			decryptCallCount++;
			return dataKey;
		},
	};

	const cachedProvider = createCachedDataKeyProvider(mockProvider, 50);

	await cachedProvider.decryptDataKey(encryptedKey);
	assert.strictEqual(decryptCallCount, 1);

	await cachedProvider.decryptDataKey(encryptedKey);
	assert.strictEqual(decryptCallCount, 1, "should use cache");

	await new Promise((resolve) => setTimeout(resolve, 60));

	await cachedProvider.decryptDataKey(encryptedKey);
	assert.strictEqual(decryptCallCount, 2, "should refresh after TTL");
});

test("createCachedDataKeyProvider passes through generateDataKey", async () => {
	const dataKey = randomBytes(32);
	const encryptedKey = randomBytes(32);
	let generateCallCount = 0;

	const mockProvider: DataKeyProvider = {
		async generateDataKey() {
			generateCallCount++;
			return { plaintext: dataKey, encrypted: encryptedKey };
		},
		async decryptDataKey() {
			return dataKey;
		},
	};

	const cachedProvider = createCachedDataKeyProvider(mockProvider);

	await cachedProvider.generateDataKey();
	await cachedProvider.generateDataKey();
	await cachedProvider.generateDataKey();

	assert.strictEqual(generateCallCount, 3, "should not cache generateDataKey");
});
