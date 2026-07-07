import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { shouldVerifyDiscoveryTls } from "./edge-tls.js";

describe("shouldVerifyDiscoveryTls", () => {
	it("verifies TLS for a deployed https host", () => {
		assert.equal(
			shouldVerifyDiscoveryTls(
				"https://api.dev.remit.example/api/auth/.well-known/openid-configuration",
			),
			true,
		);
	});

	it("skips verification for plaintext http hops", () => {
		assert.equal(
			shouldVerifyDiscoveryTls("http://host.docker.internal:5436/api/auth"),
			false,
		);
		assert.equal(
			shouldVerifyDiscoveryTls("http://api.dev.remit.example/api/auth"),
			false,
		);
	});

	it("skips verification for loopback / docker-host https", () => {
		for (const host of [
			"localhost",
			"127.0.0.1",
			"[::1]",
			"host.docker.internal",
		]) {
			assert.equal(
				shouldVerifyDiscoveryTls(`https://${host}:5436/api/auth`),
				false,
			);
		}
	});
});
