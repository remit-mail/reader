import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { BodyFetchError } from "@/hooks/useMessageBodyContent";
import {
	contentForReason,
	extractFallbackDetail,
	extractReason,
} from "./message-body-error-banner-content";

describe("contentForReason — diagnostic banner copy per failure mode (#401)", () => {
	it("renders a session-expired title for auth failures (Lambda@Edge 401/403 with x-remit-403-reason header)", () => {
		const content = contentForReason("auth", "ignored fallback");
		assert.match(content.title, /session/i);
		assert.match(content.detail, /sign in/i);
	});

	it("renders a body-missing-in-storage title for bare S3 403/404 (no edge header — OAC blocks list so missing keys 403)", () => {
		const content = contentForReason("body-missing", "ignored fallback");
		assert.match(content.title, /missing in storage/i);
		assert.match(content.detail, /reconcile|sync|support/i);
	});

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

	it("never reuses the auth copy for body-missing — these must be visibly distinct so the user knows which failure they're facing (#401 acceptance)", () => {
		const auth = contentForReason("auth", "x");
		const missing = contentForReason("body-missing", "x");
		assert.notEqual(auth.title, missing.title);
		assert.notEqual(auth.detail, missing.detail);
	});
});

describe("extractReason — pulls the discriminated reason off a BodyFetchError, falls back to generic", () => {
	it("returns the reason from a BodyFetchError instance", () => {
		const err = new BodyFetchError("body-missing", "missing", 403);
		assert.equal(extractReason(err), "body-missing");
	});

	it("returns the reason from a BodyFetchError(auth)", () => {
		const err = new BodyFetchError("auth", "Invalid id_token", 401);
		assert.equal(extractReason(err), "auth");
	});

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
