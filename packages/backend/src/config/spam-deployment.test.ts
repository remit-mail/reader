import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { spamDeploymentFromEnv } from "./spam-deployment.js";

describe("spamDeploymentFromEnv", () => {
	it("asks the inline judge by default", () => {
		assert.deepEqual(spamDeploymentFromEnv({}), {
			name: "Inline",
			thresholds: { state: "Unset" },
		});
	});

	it("asks rspamd at its URL", () => {
		assert.deepEqual(
			spamDeploymentFromEnv({
				SPAM_BACKEND: "Rspamd",
				SPAM_RSPAMD_URL: "http://rspamd:11333",
			}),
			{ name: "Rspamd", url: "http://rspamd:11333" },
		);
	});

	it("refuses an unknown backend", () => {
		assert.throws(
			() => spamDeploymentFromEnv({ SPAM_BACKEND: "SpamAssassin" }),
			/SPAM_BACKEND=SpamAssassin is not a known backend/,
		);
	});

	it("refuses rspamd without a URL", () => {
		assert.throws(
			() => spamDeploymentFromEnv({ SPAM_BACKEND: "Rspamd" }),
			/SPAM_RSPAMD_URL is not set/,
		);
	});

	it("refuses an rspamd URL that is not http", () => {
		assert.throws(
			() =>
				spamDeploymentFromEnv({
					SPAM_BACKEND: "Rspamd",
					SPAM_RSPAMD_URL: "rspamd:11333",
				}),
			/must be an http or https URL/,
		);
	});

	it("refuses thresholds under rspamd", () => {
		assert.throws(
			() =>
				spamDeploymentFromEnv({
					SPAM_BACKEND: "Rspamd",
					SPAM_RSPAMD_URL: "http://rspamd:11333",
					SPAM_AT: "0.8",
				}),
			/SPAM_AT set with SPAM_BACKEND=Rspamd/,
		);
	});

	it("refuses an rspamd URL without the rspamd backend", () => {
		assert.throws(
			() => spamDeploymentFromEnv({ SPAM_RSPAMD_URL: "http://rspamd:11333" }),
			/SPAM_RSPAMD_URL set without SPAM_BACKEND=Rspamd/,
		);
	});
});
