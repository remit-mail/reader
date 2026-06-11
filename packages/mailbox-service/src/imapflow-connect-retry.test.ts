/**
 * Unit tests for ImapFlowConnection.connect() retry semantics.
 *
 * Verifies the retry policy without touching a real IMAP server:
 * - Network errors (e.g. ECONNREFUSED) are retried with backoff before the
 *   classified MailConnectionError("network") is finally thrown.
 * - Auth errors are thrown immediately and NEVER retried.
 *
 * The private `attemptConnect` and `sleep` instance methods are stubbed so the
 * test exercises the loop logic directly and runs instantly.
 */

import assert from "node:assert/strict";
import { describe, it, mock } from "node:test";
import { ImapFlowConnection } from "./imapflow-connection.js";
import { MailConnectionError } from "./types.js";

const baseConfig = {
	host: "localhost",
	port: 143,
	user: "alice@example.com",
	credentials: { kind: "password" as const, password: "s3cr3t" },
	tls: false,
};

type WithPrivates = {
	attemptConnect: () => Promise<void>;
	sleep: (ms: number) => Promise<void>;
};

const makeErrnoError = (code: string): Error => {
	const err = new Error(`connect ${code}`);
	return Object.assign(err, { code });
};

describe("ImapFlowConnection.connect() retry policy", () => {
	it("retries network errors (ECONNREFUSED) 3x with backoff, then throws classified network error", async () => {
		const connection = new ImapFlowConnection(baseConfig);
		const priv = connection as unknown as WithPrivates;

		// Always fail with a network-level error.
		const attempt = mock.method(priv, "attemptConnect", async () => {
			throw makeErrnoError("ECONNREFUSED");
		});
		// Stub sleep so the backoff does not actually delay the test.
		mock.method(priv, "sleep", async () => {});

		await assert.rejects(
			() => connection.connect(),
			(error: unknown) => {
				assert.ok(
					error instanceof MailConnectionError,
					"final error should be a MailConnectionError",
				);
				assert.equal(error.kind, "network");
				return true;
			},
		);

		// 3 attempts total (the retry loop runs maxRetries times).
		assert.equal(attempt.mock.callCount(), 3);
	});

	it("succeeds on a later attempt when a transient network error clears", async () => {
		const connection = new ImapFlowConnection(baseConfig);
		const priv = connection as unknown as WithPrivates;

		let calls = 0;
		const attempt = mock.method(priv, "attemptConnect", async () => {
			calls += 1;
			if (calls < 2) {
				throw makeErrnoError("ECONNRESET");
			}
			// Second attempt succeeds.
		});
		mock.method(priv, "sleep", async () => {});

		await connection.connect();

		assert.equal(attempt.mock.callCount(), 2);
	});

	it("does NOT retry auth errors — throws immediately on attempt 1", async () => {
		const connection = new ImapFlowConnection(baseConfig);
		const priv = connection as unknown as WithPrivates;

		const attempt = mock.method(priv, "attemptConnect", async () => {
			throw new Error("Invalid credentials");
		});
		const sleep = mock.method(priv, "sleep", async () => {});

		await assert.rejects(
			() => connection.connect(),
			(error: unknown) => {
				assert.ok(error instanceof MailConnectionError);
				assert.equal(error.kind, "auth");
				return true;
			},
		);

		// Only one attempt, no backoff sleep.
		assert.equal(attempt.mock.callCount(), 1);
		assert.equal(sleep.mock.callCount(), 0);
	});
});
