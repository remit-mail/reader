import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import type { FatalError } from "@/lib/fatal-error";
import { FatalErrorScreen } from "./FatalErrorOverlay";

const fatal: FatalError = {
	error: new Error("Request failed with status 500"),
	message: "Request failed with status 500",
	correlationId: "abc-123",
	at: 0,
};

describe("FatalErrorScreen — the full-screen red escalation page", () => {
	it("renders a loud red full-screen overlay (not a benign grey label)", () => {
		const html = renderToString(
			createElement(FatalErrorScreen, { fatal }) as never,
		);
		assert.match(html, /data-testid="fatal-error-overlay"/);
		assert.match(html, /bg-red-700/);
		assert.match(html, /fixed inset-0/);
		assert.match(html, /role="alert"/);
	});

	it("shows the error message and correlation reference", () => {
		const html = renderToString(
			createElement(FatalErrorScreen, { fatal }) as never,
		);
		assert.match(html, /Request failed with status 500/);
		assert.match(html, /abc-123/);
	});

	it("offers Reload and Report a bug actions", () => {
		const html = renderToString(
			createElement(FatalErrorScreen, { fatal }) as never,
		);
		assert.match(html, /Reload/);
		assert.match(html, /Report a bug/);
	});
});
