/**
 * Banner rendering (#55): a banner sits on top of the toolbar and the message
 * list, so it is opaque, it says which severity it is out loud, and only an
 * error interrupts a screen reader.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import React, { createElement } from "react";
import { renderToString } from "react-dom/server";
import { ErrorBanner } from "./ErrorBanner";
import { ErrorBannerStack } from "./ErrorBannerStack";
import type { ErrorBannerEntry, ErrorBannerSeverity } from "./error-banners.js";

(globalThis as { React?: typeof React }).React = React;

const renderBanner = (severity: ErrorBannerSeverity, detail?: string): string =>
	renderToString(
		createElement(ErrorBanner, {
			id: "b1",
			severity,
			title: "Couldn't move message",
			detail,
			onDismiss: () => undefined,
		}) as never,
	);

describe("ErrorBanner", () => {
	it("interrupts assertively for an error and politely for the rest", () => {
		assert.match(renderBanner("error"), /role="alert"/);
		assert.match(renderBanner("error"), /aria-live="assertive"/);
		for (const severity of ["warning", "info"] as const) {
			assert.match(renderBanner(severity), /role="status"/);
			assert.match(renderBanner(severity), /aria-live="polite"/);
		}
	});

	it("names the severity in the dismiss label so it is not just an X", () => {
		assert.match(renderBanner("error"), /aria-label="Dismiss error"/);
		assert.match(renderBanner("warning"), /aria-label="Dismiss warning"/);
		assert.match(renderBanner("info"), /aria-label="Dismiss information"/);
	});

	it("stays opaque — no translucent surface over the message list (#55)", () => {
		const backgrounds: Record<ErrorBannerSeverity, RegExp> = {
			error: /bg-danger-soft/,
			warning: /bg-warning-soft/,
			info: /bg-accent-2-soft/,
		};
		for (const [severity, background] of Object.entries(backgrounds)) {
			const html = renderBanner(severity as ErrorBannerSeverity);
			assert.match(html, background);
			// An alpha-suffixed background (`bg-x/40`) is see-through; text over
			// the message list behind it stops being readable.
			assert.doesNotMatch(html, /class="[^"]*\sbg-[\w-]+\/\d/);
		}
	});

	it("shows the detail only when there is one", () => {
		assert.match(renderBanner("error", "Connection reset"), /Connection reset/);
		assert.doesNotMatch(renderBanner("error"), /Connection reset/);
	});
});

const entry = (
	id: string,
	severity: ErrorBannerSeverity,
	title: string,
): ErrorBannerEntry => ({
	id,
	severity,
	title,
	createdAt: 0,
});

const renderStack = (errors: ErrorBannerEntry[]): string =>
	renderToString(
		createElement(ErrorBannerStack, {
			errors,
			onDismiss: () => undefined,
		}) as never,
	);

describe("ErrorBannerStack", () => {
	it("renders nothing at all when there is nothing to say", () => {
		assert.equal(renderStack([]), "");
	});

	it("stacks every banner it is given under one labelled region", () => {
		const html = renderStack([
			entry("a", "error", "Couldn't delete"),
			entry("b", "info", "Sync finished"),
		]);
		assert.match(html, /aria-label="Notifications"/);
		assert.match(html, /Couldn&#x27;t delete/);
		assert.match(html, /Sync finished/);
	});

	it("lets clicks through the region so it never blocks the mail behind it", () => {
		const html = renderStack([entry("a", "error", "Couldn't delete")]);
		assert.match(html, /pointer-events-none/);
		assert.match(html, /pointer-events-auto/);
	});
});
