import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import type { FatalError } from "@/lib/fatal-error";
import { FatalErrorScreen } from "./FatalErrorOverlay";

const recoverableFatal: FatalError = {
	error: new Error("Request failed with status 500"),
	message: "Request failed with status 500",
	correlationId: "abc-123",
	at: 0,
	recoverable: true,
};

const deterministicFatal: FatalError = {
	error: new Error("date value is not finite in DateTimeFormat format()"),
	message: "date value is not finite in DateTimeFormat format()",
	correlationId: "def-456",
	at: 0,
	recoverable: false,
	stack: "Error: date value is not finite\n    at format",
	componentStack: "\n    at AccountsSettings\n    at Route",
};

const render = (fatal: FatalError): string =>
	renderToString(createElement(FatalErrorScreen, { fatal }) as never);

describe("FatalErrorScreen — the full-screen red escalation page", () => {
	it("renders a loud red full-screen overlay (not a benign grey label)", () => {
		const html = render(recoverableFatal);
		assert.match(html, /data-testid="fatal-error-overlay"/);
		assert.match(html, /bg-red-700/);
		assert.match(html, /fixed inset-0/);
		assert.match(html, /role="alert"/);
	});

	it("shows the error message and correlation reference", () => {
		const html = render(recoverableFatal);
		assert.match(html, /Request failed with status 500/);
		assert.match(html, /abc-123/);
	});

	it("always offers Report a bug and Copy full details", () => {
		for (const fatal of [recoverableFatal, deterministicFatal]) {
			const html = render(fatal);
			assert.match(html, /Report a bug/);
			assert.match(html, /Copy full details/);
		}
	});
});

describe("FatalErrorScreen — recoverable vs fatal affordances", () => {
	it("a recoverable error offers Retry and no dead-end safe-route link", () => {
		const html = render(recoverableFatal);
		assert.match(html, /Retry/);
		assert.doesNotMatch(html, /Go to inbox/);
	});

	it("a deterministic fatal offers a safe route out — never a re-crashing Retry", () => {
		const html = render(deterministicFatal);
		assert.doesNotMatch(html, />Retry</);
		assert.match(html, /Go to inbox/);
		assert.match(html, /href="\/mail"/);
	});
});
