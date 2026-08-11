/**
 * Regression for the published Storybook site: registering MSW's service
 * worker at a root-absolute URL resolves off the GitHub Pages `/reader/`
 * subpath, so the worker script 404s and every story that needs mocked
 * requests fails to render. See https://mswjs.io/docs/cli/init.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { resolveMockServiceWorkerUrl } from "./mock-service-worker-url.js";

describe("resolveMockServiceWorkerUrl", () => {
	it("stays root-absolute for the Vitest story test runner", () => {
		assert.equal(resolveMockServiceWorkerUrl(true), "/mockServiceWorker.js");
	});

	it("resolves next to a subpath-hosted iframe.html, not the site root", () => {
		const url = resolveMockServiceWorkerUrl(false);
		const resolved = new URL(
			url,
			"https://remit-mail.github.io/reader/iframe.html",
		);
		assert.equal(
			resolved.href,
			"https://remit-mail.github.io/reader/mockServiceWorker.js",
		);
	});

	it("still resolves correctly when served from the root", () => {
		const url = resolveMockServiceWorkerUrl(false);
		const resolved = new URL(url, "http://localhost:6006/iframe.html");
		assert.equal(resolved.href, "http://localhost:6006/mockServiceWorker.js");
	});
});
