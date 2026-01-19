import assert from "node:assert";
import { randomBytes } from "node:crypto";
import { after, before, describe, test } from "node:test";
import {
	createCachedDataKeyProvider,
	createKmsDataKeyProvider,
	createSecretsService,
	type DataKeyProvider,
	decryptWithKey,
	encryptWithKey,
	FAKE_KMS_KEY_ID,
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

describe("createFakeDataKeyProvider", () => {
	let originalKmsKeyId: string | undefined;
	let originalFakeDataKey: string | undefined;

	before(() => {
		originalKmsKeyId = process.env.KMS_KEY_ID;
		originalFakeDataKey = process.env.FAKE_KMS_DATAKEY;
		process.env.KMS_KEY_ID = FAKE_KMS_KEY_ID;
		process.env.FAKE_KMS_DATAKEY = "test-data-key-for-unit-tests";
	});

	after(() => {
		if (originalKmsKeyId === undefined) {
			delete process.env.KMS_KEY_ID;
		} else {
			process.env.KMS_KEY_ID = originalKmsKeyId;
		}
		if (originalFakeDataKey === undefined) {
			delete process.env.FAKE_KMS_DATAKEY;
		} else {
			process.env.FAKE_KMS_DATAKEY = originalFakeDataKey;
		}
	});

	test("createKmsDataKeyProvider with FAKE_KMS_KEY_ID returns fake provider", async () => {
		const provider = createKmsDataKeyProvider(FAKE_KMS_KEY_ID);

		const { plaintext, encrypted } = await provider.generateDataKey();

		assert.ok(
			plaintext instanceof Uint8Array,
			"plaintext should be Uint8Array",
		);
		assert.ok(
			encrypted instanceof Uint8Array,
			"encrypted should be Uint8Array",
		);
		assert.strictEqual(
			plaintext.length,
			32,
			"plaintext should be 32 bytes (AES-256)",
		);
	});

	test("fake provider encrypts and decrypts data keys correctly", async () => {
		const provider = createKmsDataKeyProvider(FAKE_KMS_KEY_ID);

		const { plaintext, encrypted } = await provider.generateDataKey();
		const decrypted = await provider.decryptDataKey(encrypted);

		assert.deepStrictEqual(
			Buffer.from(decrypted),
			Buffer.from(plaintext),
			"decrypted key should match original plaintext",
		);
	});

	test("secrets service works end-to-end with fake provider", async () => {
		const provider = createKmsDataKeyProvider(FAKE_KMS_KEY_ID);
		const secrets = createSecretsService(provider);

		const plaintext = "super-secret-password-for-fake-provider";

		const encrypted = await secrets.encrypt(plaintext);

		assert.ok(encrypted.encryptedDek, "should have encrypted DEK");
		assert.ok(encrypted.encryptedData, "should have encrypted data");
		assert.ok(encrypted.iv, "should have IV");
		assert.ok(encrypted.authTag, "should have auth tag");

		const decrypted = await secrets.decrypt(encrypted);

		assert.strictEqual(
			decrypted,
			plaintext,
			"decrypted text should match original",
		);
	});

	test("fake provider uses consistent key from FAKE_KMS_DATAKEY", async () => {
		const provider = createKmsDataKeyProvider(FAKE_KMS_KEY_ID);

		const key1 = await provider.generateDataKey();
		const key2 = await provider.generateDataKey();

		assert.deepStrictEqual(
			Buffer.from(key1.plaintext),
			Buffer.from(key2.plaintext),
			"each call should produce the same key (derived from env)",
		);
	});

	test("fake provider throws when FAKE_KMS_DATAKEY is not set", async () => {
		const originalKey = process.env.FAKE_KMS_DATAKEY;
		delete process.env.FAKE_KMS_DATAKEY;

		try {
			const provider = createKmsDataKeyProvider(FAKE_KMS_KEY_ID);
			await assert.rejects(
				() => provider.generateDataKey(),
				/FAKE_KMS_DATAKEY environment variable is required/,
			);
		} finally {
			process.env.FAKE_KMS_DATAKEY = originalKey;
		}
	});
});
