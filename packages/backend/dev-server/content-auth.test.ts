import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createContentSigner } from "../src/derive/contentSignature.js";
import { authorizeContentRequest } from "./content-auth.js";

const SECRET = "test-master-secret-at-least-32-chars-long";
const PATH = "accounts/cfg-alice/acc-alice/messages/msg-1/parts/1.2";
const now = () => Math.floor(Date.now() / 1000);

describe("authorizeContentRequest", () => {
	it("is a no-op outside Postgres mode (AWS serves unsigned URLs)", () => {
		const result = authorizeContentRequest({
			dataBackend: undefined,
			secret: undefined,
			relativePath: PATH,
			exp: undefined,
			sig: undefined,
			nowSeconds: now(),
		});
		assert.deepEqual(result, { authorized: true });
	});

	it("authorizes a validly signed request in Postgres mode", () => {
		const { exp, sig } = createContentSigner(SECRET)(PATH);
		const result = authorizeContentRequest({
			dataBackend: "postgres",
			secret: SECRET,
			relativePath: PATH,
			exp: String(exp),
			sig,
			nowSeconds: now(),
		});
		assert.deepEqual(result, { authorized: true });
	});

	it("returns 401 when the signature is absent", () => {
		const result = authorizeContentRequest({
			dataBackend: "postgres",
			secret: SECRET,
			relativePath: PATH,
			exp: undefined,
			sig: undefined,
			nowSeconds: now(),
		});
		assert.equal(result.authorized, false);
		assert.equal(result.authorized === false && result.status, 401);
	});

	it("returns 403 for a signature minted for another account's path", () => {
		const { exp, sig } = createContentSigner(SECRET)(PATH);
		const result = authorizeContentRequest({
			dataBackend: "postgres",
			secret: SECRET,
			relativePath: "accounts/cfg-bob/acc-bob/messages/msg-9/parts/1.2",
			exp: String(exp),
			sig,
			nowSeconds: now(),
		});
		assert.equal(result.authorized, false);
		assert.equal(result.authorized === false && result.status, 403);
	});

	it("returns 403 for an expired signature", () => {
		const { exp, sig } = createContentSigner(SECRET, -20)(PATH);
		const result = authorizeContentRequest({
			dataBackend: "postgres",
			secret: SECRET,
			relativePath: PATH,
			exp: String(exp),
			sig,
			nowSeconds: now(),
		});
		assert.equal(result.authorized, false);
		assert.equal(result.authorized === false && result.status, 403);
	});

	it("fails closed with 500 in Postgres mode when no signing secret is configured", () => {
		const result = authorizeContentRequest({
			dataBackend: "postgres",
			secret: undefined,
			relativePath: PATH,
			exp: "123",
			sig: "whatever",
			nowSeconds: now(),
		});
		assert.equal(result.authorized, false);
		assert.equal(result.authorized === false && result.status, 500);
	});
});
