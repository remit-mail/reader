import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { getSendMessageMaxAttempts } from "./lambda-context.js";

describe("the retry budget is the queue's, read from the environment", () => {
	it("takes the deployment's own maxReceiveCount when it is set", () => {
		// The e2e stack sets 1 (`deploy/vps/e2e.env`): its pollers hold a record
		// for 300s, so a spec cannot wait out three deliveries.
		assert.equal(
			getSendMessageMaxAttempts({ SEND_MESSAGE_MAX_ATTEMPTS: "1" }),
			1,
		);
		assert.equal(
			getSendMessageMaxAttempts({ SEND_MESSAGE_MAX_ATTEMPTS: "5" }),
			5,
		);
	});

	it("falls back to remit-smtp's maxReceiveCount when it is unset or unusable", () => {
		assert.equal(getSendMessageMaxAttempts({}), 3);
		assert.equal(
			getSendMessageMaxAttempts({ SEND_MESSAGE_MAX_ATTEMPTS: "" }),
			3,
		);
		assert.equal(
			getSendMessageMaxAttempts({ SEND_MESSAGE_MAX_ATTEMPTS: "not-a-number" }),
			3,
		);
		assert.equal(
			getSendMessageMaxAttempts({ SEND_MESSAGE_MAX_ATTEMPTS: "0" }),
			3,
		);
	});
});
