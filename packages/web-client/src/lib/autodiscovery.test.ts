import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	discoverSettings,
	getAppPasswordUrl,
	getDiscoveryStatusMessage,
} from "./autodiscovery.js";

// Provider table unit tests for top 5 providers (no network calls)
describe("autodiscovery provider table", () => {
	it("returns heuristic for unknown domain", async () => {
		// Use a clearly fake domain — network calls will fail/timeout
		// In the test environment there's no network, so it falls to heuristic
		const result = await discoverSettings(
			"user@no-such-domain-xyz123.test",
			100,
		);
		assert.ok(result, "should return heuristic result");
		assert.equal(result.source, "heuristic");
		assert.equal(result.imap.host, "imap.no-such-domain-xyz123.test");
		assert.equal(result.smtp.host, "smtp.no-such-domain-xyz123.test");
	});

	it("returns null for invalid email", async () => {
		const result = await discoverSettings("not-an-email");
		assert.equal(result, null);
	});
});

describe("getDiscoveryStatusMessage", () => {
	it("includes domain in message", () => {
		const msg = getDiscoveryStatusMessage("user@fastmail.com");
		assert.ok(msg.includes("fastmail.com"), "should include domain");
	});
});

describe("getAppPasswordUrl", () => {
	it("returns Gmail app password URL", () => {
		const url = getAppPasswordUrl("user@gmail.com");
		assert.ok(url?.includes("google.com"), "should include google.com");
	});

	it("returns undefined for unknown domain", () => {
		const url = getAppPasswordUrl("user@unknown-provider.test");
		assert.equal(url, undefined);
	});
});
