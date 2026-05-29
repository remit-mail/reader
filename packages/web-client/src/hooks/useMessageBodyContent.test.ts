import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import {
	BodyFetchError,
	classifyBodyFetchFailure,
	fetchBodyContent,
	isContentTypeMismatch,
	isSpaShellResponse,
} from "./useMessageBodyContent";

const SPA_SHELL = `<!doctype html>
<html lang="en">
  <head><title>Remit</title></head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>`;

describe("isSpaShellResponse — guard against CloudFront 403/404 → /index.html leak (#310 review)", () => {
	it("flags the SPA shell HTML served as text/html", () => {
		assert.equal(
			isSpaShellResponse(SPA_SHELL, "text/html; charset=utf-8"),
			true,
		);
	});

	it("flags single-quoted variant of the React mount node", () => {
		const html = `<html><body><div id='root'></div></body></html>`;
		assert.equal(isSpaShellResponse(html, "text/html"), true);
	});

	it("does not flag a real email's HTML body (no #root mount node)", () => {
		const emailHtml = `<html><body><p>Hello there!</p></body></html>`;
		assert.equal(isSpaShellResponse(emailHtml, "text/html"), false);
	});

	it("does not flag identical bytes when the Content-Type is not text/html", () => {
		assert.equal(
			isSpaShellResponse(SPA_SHELL, "application/octet-stream"),
			false,
			"Content-Type gates the check — a plain-text body that happens to contain '<div id=\"root\">' must not trigger",
		);
	});

	it("treats a missing Content-Type as not-html (no false positive on null)", () => {
		assert.equal(isSpaShellResponse(SPA_SHELL, null), false);
	});
});

describe("isContentTypeMismatch — text/plain part must never come back as text/html", () => {
	it("flags a text-kind fetch that returns text/html", () => {
		assert.equal(
			isContentTypeMismatch("text", "text/html; charset=utf-8"),
			true,
		);
	});

	it("does not flag a text-kind fetch that returns text/plain", () => {
		assert.equal(
			isContentTypeMismatch("text", "text/plain; charset=utf-8"),
			false,
		);
	});

	it("does not flag a text-kind fetch that returns application/octet-stream (dev-server)", () => {
		assert.equal(
			isContentTypeMismatch("text", "application/octet-stream"),
			false,
		);
	});

	it("does not flag an html-kind fetch returning text/html (legitimate)", () => {
		assert.equal(
			isContentTypeMismatch("html", "text/html; charset=utf-8"),
			false,
		);
	});

	it("treats a missing Content-Type as not-mismatch (the SPA-shell guard catches the html-shaped variant separately)", () => {
		assert.equal(isContentTypeMismatch("text", null), false);
	});
});

describe("classifyBodyFetchFailure — distinguishes auth failure vs. missing-S3-object 403 (#401)", () => {
	it("classifies 401 as auth (Lambda@Edge denies missing/invalid tokens with 401)", () => {
		assert.equal(classifyBodyFetchFailure(401, null), "auth");
		assert.equal(classifyBodyFetchFailure(401, "auth-missing"), "auth");
		assert.equal(classifyBodyFetchFailure(401, "auth-invalid"), "auth");
	});

	it("classifies a 403 carrying the edge x-remit-403-reason header as auth (tenant-mismatch)", () => {
		assert.equal(
			classifyBodyFetchFailure(403, "tenant-mismatch"),
			"auth",
			"a 403 with the edge reason header is an auth denial, not a storage miss",
		);
	});

	it("classifies a bare 403 with NO edge header as body-missing (S3 origin response — OAC blocks list so missing objects 403)", () => {
		assert.equal(
			classifyBodyFetchFailure(403, null),
			"body-missing",
			"a 403 without the edge reason header originates from S3 — the object is missing in storage",
		);
	});

	it("treats an empty / whitespace-only edge reason header as absent (a stripped header is not a real auth denial)", () => {
		assert.equal(classifyBodyFetchFailure(403, ""), "body-missing");
		assert.equal(classifyBodyFetchFailure(403, "   "), "body-missing");
	});

	it("classifies 404 as body-missing (defensive — current infra never produces a 404 here but a future bucket-policy change could)", () => {
		assert.equal(classifyBodyFetchFailure(404, null), "body-missing");
	});

	it("classifies other 4xx/5xx as generic", () => {
		assert.equal(classifyBodyFetchFailure(400, null), "generic");
		assert.equal(classifyBodyFetchFailure(500, null), "generic");
		assert.equal(classifyBodyFetchFailure(502, null), "generic");
	});
});

describe("fetchBodyContent — throws BodyFetchError with discriminated reason (#401)", () => {
	const originalFetch = globalThis.fetch;
	beforeEach(() => {
		// Stub fetch on each test so the body-fetcher hits a known response
		// shape without any real network or Amplify involvement.
	});
	afterEach(() => {
		globalThis.fetch = originalFetch;
	});

	const stubFetch = (
		status: number,
		headers: Record<string, string> = {},
		body = "",
	): void => {
		globalThis.fetch = (async () =>
			new Response(body, { status, headers })) as typeof fetch;
	};

	it("throws BodyFetchError(reason=auth) on a 401 from the edge", async () => {
		stubFetch(
			401,
			{ "x-remit-403-reason": "auth-invalid" },
			"Invalid id_token",
		);
		await assert.rejects(
			() => fetchBodyContent("/content/accounts/x/messages/m/body.eml", "text"),
			(err: unknown) => {
				assert.ok(err instanceof BodyFetchError);
				assert.equal(err.reason, "auth");
				assert.equal(err.status, 401);
				return true;
			},
		);
	});

	it("throws BodyFetchError(reason=auth) on a 403 with x-remit-403-reason (tenant-mismatch)", async () => {
		stubFetch(
			403,
			{ "x-remit-403-reason": "tenant-mismatch" },
			"Tenant mismatch",
		);
		await assert.rejects(
			() => fetchBodyContent("/content/accounts/x/messages/m/body.eml", "text"),
			(err: unknown) => {
				assert.ok(err instanceof BodyFetchError);
				assert.equal(err.reason, "auth");
				assert.equal(err.status, 403);
				return true;
			},
		);
	});

	it("throws BodyFetchError(reason=body-missing) on a bare S3 403 (no edge reason header)", async () => {
		stubFetch(403, {}, "Forbidden");
		await assert.rejects(
			() => fetchBodyContent("/content/accounts/x/messages/m/body.eml", "text"),
			(err: unknown) => {
				assert.ok(err instanceof BodyFetchError);
				assert.equal(err.reason, "body-missing");
				assert.equal(err.status, 403);
				return true;
			},
		);
	});

	it("throws BodyFetchError(reason=generic) on a 5xx", async () => {
		stubFetch(502, {}, "Bad Gateway");
		await assert.rejects(
			() => fetchBodyContent("/content/accounts/x/messages/m/body.eml", "text"),
			(err: unknown) => {
				assert.ok(err instanceof BodyFetchError);
				assert.equal(err.reason, "generic");
				assert.equal(err.status, 502);
				return true;
			},
		);
	});

	it("throws BodyFetchError(reason=content-type-mismatch) when a text part returns text/html", async () => {
		stubFetch(
			200,
			{ "content-type": "text/html; charset=utf-8" },
			"<html>oops</html>",
		);
		await assert.rejects(
			() => fetchBodyContent("/content/accounts/x/messages/m/body.eml", "text"),
			(err: unknown) => {
				assert.ok(err instanceof BodyFetchError);
				assert.equal(err.reason, "content-type-mismatch");
				return true;
			},
		);
	});

	it("throws BodyFetchError(reason=spa-shell-leak) when the response is the SPA shell HTML", async () => {
		stubFetch(
			200,
			{ "content-type": "text/html; charset=utf-8" },
			`<!doctype html><html><body><div id="root"></div></body></html>`,
		);
		await assert.rejects(
			() => fetchBodyContent("/content/accounts/x/messages/m/body.eml", "html"),
			(err: unknown) => {
				assert.ok(err instanceof BodyFetchError);
				assert.equal(err.reason, "spa-shell-leak");
				return true;
			},
		);
	});

	it("returns the body text on a 2xx with a matching Content-Type", async () => {
		stubFetch(
			200,
			{ "content-type": "text/plain; charset=utf-8" },
			"hello world",
		);
		const body = await fetchBodyContent(
			"/content/accounts/x/messages/m/body.eml",
			"text",
		);
		assert.equal(body, "hello world");
	});
});
