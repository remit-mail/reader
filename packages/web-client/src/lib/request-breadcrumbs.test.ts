import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import {
	__resetRequestBreadcrumbs,
	getFailingRequest,
	getRecentRequests,
	recordRequest,
	requestPath,
} from "./request-breadcrumbs";

const response = (
	status: number,
	headers: Record<string, string> = {},
): Response => new Response(null, { status, headers });

beforeEach(() => {
	__resetRequestBreadcrumbs();
});

describe("requestPath — redaction boundary", () => {
	it("keeps the pathname and drops the query string", () => {
		assert.equal(requestPath("/api/search?q=secret+query+text"), "/api/search");
	});

	it("drops the query on an absolute URL too", () => {
		assert.equal(
			requestPath("https://app.example.com/api/messages?q=private"),
			"/api/messages",
		);
	});

	it("drops a hash fragment", () => {
		assert.equal(requestPath("/api/thing#section"), "/api/thing");
	});

	it("keeps opaque path ids (already public in the URL section)", () => {
		assert.equal(
			requestPath("/api/messages/abc-123-def"),
			"/api/messages/abc-123-def",
		);
	});

	it("accepts a URL instance", () => {
		assert.equal(
			requestPath(new URL("https://app.example.com/api/x?q=1")),
			"/api/x",
		);
	});

	it("accepts a Request instance", () => {
		assert.equal(
			requestPath(new Request("https://app.example.com/api/y?token=abc")),
			"/api/y",
		);
	});
});

describe("recordRequest", () => {
	it("captures metadata only — never the query or the body", () => {
		recordRequest({
			input: "/api/search?q=confidential",
			init: { method: "POST", body: JSON.stringify({ subject: "secret" }) },
			response: response(200),
			durationMs: 12.6,
		});
		const [entry] = getRecentRequests();
		assert.equal(entry.method, "POST");
		assert.equal(entry.path, "/api/search");
		assert.equal(entry.status, 200);
		assert.equal(entry.durationMs, 13);
		// The breadcrumb shape has no body/query field; assert nothing leaked in.
		const serialized = JSON.stringify(entry);
		assert.ok(
			!serialized.includes("confidential"),
			"query text must not be captured",
		);
		assert.ok(
			!serialized.includes("secret"),
			"request body must not be captured",
		);
	});

	it("defaults the method to GET", () => {
		recordRequest({
			input: "/api/thing",
			response: response(204),
			durationMs: 1,
		});
		assert.equal(getRecentRequests()[0].method, "GET");
	});

	it("reads the method from a Request instance", () => {
		recordRequest({
			input: new Request("https://app.example.com/api/z", { method: "delete" }),
			response: response(200),
			durationMs: 1,
		});
		assert.equal(getRecentRequests()[0].method, "DELETE");
	});

	it("records status 0 and no correlation id for a transport failure", () => {
		recordRequest({ input: "/api/thing", durationMs: 5000 });
		const [entry] = getRecentRequests();
		assert.equal(entry.status, 0);
		assert.equal(entry.correlationId, undefined);
	});

	it("reads the correlation id from the first present header", () => {
		recordRequest({
			input: "/api/a",
			response: response(200, { "x-request-id": "req-42" }),
			durationMs: 1,
		});
		assert.equal(getRecentRequests()[0].correlationId, "req-42");
	});

	it("keeps only the last ten requests", () => {
		for (let i = 0; i < 14; i++) {
			recordRequest({
				input: `/api/n/${i}`,
				response: response(200),
				durationMs: 1,
			});
		}
		const entries = getRecentRequests();
		assert.equal(entries.length, 10);
		assert.equal(entries[0].path, "/api/n/4");
		assert.equal(entries[9].path, "/api/n/13");
	});
});

describe("getFailingRequest", () => {
	it("returns the most recent HTTP error", () => {
		recordRequest({ input: "/api/ok", response: response(200), durationMs: 1 });
		recordRequest({
			input: "/api/bad",
			response: response(500),
			durationMs: 1,
		});
		recordRequest({
			input: "/api/ok2",
			response: response(200),
			durationMs: 1,
		});
		assert.equal(getFailingRequest()?.path, "/api/bad");
	});

	it("treats a transport failure as failing", () => {
		recordRequest({ input: "/api/gone", durationMs: 100 });
		assert.equal(getFailingRequest()?.status, 0);
	});

	it("returns undefined when every request succeeded", () => {
		recordRequest({ input: "/api/ok", response: response(200), durationMs: 1 });
		recordRequest({
			input: "/api/ok2",
			response: response(304),
			durationMs: 1,
		});
		assert.equal(getFailingRequest(), undefined);
	});
});
