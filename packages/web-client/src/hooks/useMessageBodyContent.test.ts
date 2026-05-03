import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
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
