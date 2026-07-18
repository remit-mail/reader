import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import {
	createContentSigner,
	getContentSigner,
	verifyContentSignature,
} from "./contentSignature.js";

const SECRET = "test-master-secret-at-least-32-chars-long";
const PATH_A = "accounts/cfg-alice/acc-alice/messages/msg-1/parts/1.2";
const PATH_B = "accounts/cfg-bob/acc-bob/messages/msg-9/parts/1.2";

const nowSeconds = () => Math.floor(Date.now() / 1000);

describe("content signature: sign + verify round trip", () => {
	it("a freshly signed URL verifies", () => {
		const { exp, sig } = createContentSigner(SECRET)(PATH_A);
		const result = verifyContentSignature(
			PATH_A,
			String(exp),
			sig,
			SECRET,
			nowSeconds(),
		);
		assert.deepEqual(result, { valid: true });
	});

	it("rejects a signature minted for a different account's path (cross-account IDOR defense)", () => {
		const { exp, sig } = createContentSigner(SECRET)(PATH_A);
		// Present account A's signature against account B's path.
		const result = verifyContentSignature(
			PATH_B,
			String(exp),
			sig,
			SECRET,
			nowSeconds(),
		);
		assert.deepEqual(result, { valid: false, reason: "bad-signature" });
	});

	it("rejects a tampered signature", () => {
		const { exp, sig } = createContentSigner(SECRET)(PATH_A);
		const tampered = `${sig.slice(0, -1)}${sig.endsWith("A") ? "B" : "A"}`;
		const result = verifyContentSignature(
			PATH_A,
			String(exp),
			tampered,
			SECRET,
			nowSeconds(),
		);
		assert.equal(result.valid, false);
	});

	it("rejects a valid signature verified with the wrong secret", () => {
		const { exp, sig } = createContentSigner(SECRET)(PATH_A);
		const result = verifyContentSignature(
			PATH_A,
			String(exp),
			sig,
			"a-different-master-secret-also-32-chars",
			nowSeconds(),
		);
		assert.deepEqual(result, { valid: false, reason: "bad-signature" });
	});

	it("rejects an expired signature", () => {
		// Negative TTL mints a signature whose expiry is already in the past.
		const { exp, sig } = createContentSigner(SECRET, -20)(PATH_A);
		assert.ok(exp < nowSeconds());
		const result = verifyContentSignature(
			PATH_A,
			String(exp),
			sig,
			SECRET,
			nowSeconds(),
		);
		assert.deepEqual(result, { valid: false, reason: "expired" });
	});

	it("reports missing exp/sig distinctly from a bad signature", () => {
		assert.deepEqual(
			verifyContentSignature(
				PATH_A,
				undefined,
				undefined,
				SECRET,
				nowSeconds(),
			),
			{ valid: false, reason: "missing" },
		);
	});

	it("rejects a non-integer exp as malformed", () => {
		const { sig } = createContentSigner(SECRET)(PATH_A);
		assert.deepEqual(
			verifyContentSignature(PATH_A, "not-a-number", sig, SECRET, nowSeconds()),
			{ valid: false, reason: "malformed" },
		);
	});
});

describe("getContentSigner", () => {
	const ORIGINAL_BACKEND = process.env.DATA_BACKEND;
	const ORIGINAL_SECRET = process.env.BETTER_AUTH_SECRET;

	afterEach(() => {
		if (ORIGINAL_BACKEND === undefined) delete process.env.DATA_BACKEND;
		else process.env.DATA_BACKEND = ORIGINAL_BACKEND;
		if (ORIGINAL_SECRET === undefined) delete process.env.BETTER_AUTH_SECRET;
		else process.env.BETTER_AUTH_SECRET = ORIGINAL_SECRET;
	});

	it("returns undefined outside Postgres mode (AWS keeps unsigned URLs)", () => {
		delete process.env.DATA_BACKEND;
		assert.equal(getContentSigner(), undefined);
	});

	it("returns a working signer in Postgres mode", () => {
		process.env.DATA_BACKEND = "postgres";
		process.env.BETTER_AUTH_SECRET = SECRET;
		const signer = getContentSigner();
		assert.ok(signer);
		const { exp, sig } = signer(PATH_A);
		assert.deepEqual(
			verifyContentSignature(PATH_A, String(exp), sig, SECRET, nowSeconds()),
			{ valid: true },
		);
	});

	it("throws in Postgres mode when the master secret is missing (fail loud)", () => {
		process.env.DATA_BACKEND = "postgres";
		delete process.env.BETTER_AUTH_SECRET;
		assert.throws(() => getContentSigner(), /BETTER_AUTH_SECRET/);
	});

	it("returns a working signer in SQLite mode", () => {
		process.env.DATA_BACKEND = "sqlite";
		process.env.BETTER_AUTH_SECRET = SECRET;
		const signer = getContentSigner();
		assert.ok(signer);
		const { exp, sig } = signer(PATH_A);
		assert.deepEqual(
			verifyContentSignature(PATH_A, String(exp), sig, SECRET, nowSeconds()),
			{ valid: true },
		);
	});

	it("throws in SQLite mode when the master secret is missing (fail loud)", () => {
		process.env.DATA_BACKEND = "sqlite";
		delete process.env.BETTER_AUTH_SECRET;
		assert.throws(() => getContentSigner(), /BETTER_AUTH_SECRET/);
	});
});
