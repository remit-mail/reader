import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	contentForReason,
	extractFallbackDetail,
	extractReason,
} from "./message-body-error-banner-content";

describe("contentForReason — diagnostic banner copy per failure mode (#401)", () => {
	it("renders a generic title for other 4xx/5xx and falls back to the error's own message in the detail", () => {
		const content = contentForReason("generic", "Network connection lost");
		assert.match(content.title, /couldn.?t load/i);
		assert.equal(content.detail, "Network connection lost");
	});

	it("renders a generic-but-safe title for content-type-mismatch (the actual reason is too technical for the user, the security guard already refused to render)", () => {
		const content = contentForReason("content-type-mismatch", "ignored");
		assert.match(content.title, /couldn.?t load/i);
		assert.match(content.detail, /content type|unexpected/i);
	});

	it("renders a generic title for the spa-shell-leak regression guard (#310) and flags it as an infrastructure bug", () => {
		const content = contentForReason("spa-shell-leak", "ignored");
		assert.match(content.title, /couldn.?t load/i);
		assert.match(content.detail, /shell|infrastructure|report/i);
	});
});

describe("extractReason — pulls the discriminated reason off a BodyFetchError, falls back to generic", () => {
	it("falls back to generic for a plain Error (e.g. a network error before fetch returned)", () => {
		assert.equal(extractReason(new Error("offline")), "generic");
	});

	it("falls back to generic for unknown shapes (null, undefined, strings)", () => {
		assert.equal(extractReason(undefined), "generic");
		assert.equal(extractReason(null), "generic");
		assert.equal(extractReason("just a string"), "generic");
		assert.equal(extractReason(42), "generic");
	});
});

describe("extractFallbackDetail — used only when contentForReason picks the generic branch", () => {
	it("returns an Error.message", () => {
		assert.equal(extractFallbackDetail(new Error("boom")), "boom");
	});

	it("returns a string as-is", () => {
		assert.equal(extractFallbackDetail("network error"), "network error");
	});

	it("returns a stable generic message for other shapes (never the raw object, never undefined)", () => {
		const detail = extractFallbackDetail({ status: 502 });
		assert.equal(typeof detail, "string");
		assert.ok(detail.length > 0);
	});
});
