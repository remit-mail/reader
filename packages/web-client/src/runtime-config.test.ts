import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { getRuntimeConfig } from "./runtime-config";

afterEach(() => {
	globalThis.__REMIT_CONFIG__ = undefined;
});

describe("getRuntimeConfig tlsMode", () => {
	it("defaults to off when config.js sets nothing", () => {
		globalThis.__REMIT_CONFIG__ = {};
		assert.equal(getRuntimeConfig().tlsMode, "off");
	});

	it("passes through each recognized TLS_MODE value", () => {
		for (const mode of ["internal", "acme", "tailscale", "off"] as const) {
			globalThis.__REMIT_CONFIG__ = { tlsMode: mode };
			assert.equal(getRuntimeConfig().tlsMode, mode);
		}
	});

	it("falls back to off for a value config.js never declares", () => {
		globalThis.__REMIT_CONFIG__ = { tlsMode: "quantum" };
		assert.equal(getRuntimeConfig().tlsMode, "off");
	});
});

describe("getRuntimeConfig updateMode", () => {
	it("defaults to self when config.js sets nothing", () => {
		globalThis.__REMIT_CONFIG__ = {};
		assert.equal(getRuntimeConfig().updateMode, "self");
	});

	it("passes through managed", () => {
		globalThis.__REMIT_CONFIG__ = { updateMode: "managed" };
		assert.equal(getRuntimeConfig().updateMode, "managed");
	});

	it("falls back to self for a value config.js never declares", () => {
		globalThis.__REMIT_CONFIG__ = { updateMode: "auto" };
		assert.equal(getRuntimeConfig().updateMode, "self");
	});
});
