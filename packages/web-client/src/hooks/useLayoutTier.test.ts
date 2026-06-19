import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { resolveLayoutTier } from "./useLayoutTier";

describe("resolveLayoutTier breakpoints (#784)", () => {
	it("is phone below 768", () => {
		assert.equal(resolveLayoutTier(767), "phone");
		assert.equal(resolveLayoutTier(390), "phone");
		assert.equal(resolveLayoutTier(0), "phone");
	});

	it("is tablet from 768 up to 1023", () => {
		assert.equal(resolveLayoutTier(768), "tablet");
		assert.equal(resolveLayoutTier(900), "tablet");
		assert.equal(resolveLayoutTier(1023), "tablet");
	});

	it("is desktop from 1024 up", () => {
		assert.equal(resolveLayoutTier(1024), "desktop");
		assert.equal(resolveLayoutTier(1440), "desktop");
	});
});
