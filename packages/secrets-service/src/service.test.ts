import assert from "node:assert";
import { test } from "node:test";
import { createMockSecretsService } from "./service.js";

test("mock secrets service encrypts and decrypts", async () => {
	const secrets = createMockSecretsService();
	const plaintext = "super-secret-password";

	const encrypted = await secrets.encrypt(plaintext);

	const decrypted = await secrets.decrypt(encrypted);
	assert.strictEqual(decrypted, plaintext);
});
