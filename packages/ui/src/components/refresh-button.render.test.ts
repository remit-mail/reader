import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import {
	RefreshButton,
	type RefreshButtonProps,
	type RefreshControlState,
} from "./refresh-button.js";

const render = (overrides: Partial<RefreshButtonProps> = {}): string =>
	renderToString(
		createElement(RefreshButton, {
			state: "idle",
			label: "Refresh inbox",
			onRefresh: () => undefined,
			...overrides,
		}),
	);

const stateOf = (html: string): RefreshControlState =>
	html.includes("animate-spin")
		? "refreshing"
		: /text-danger/.test(html)
			? "error"
			: /text-positive/.test(html)
				? "success"
				: "idle";

describe("RefreshButton", () => {
	it("names the plain action when idle", () => {
		const html = render();
		assert.match(html, /aria-label="Refresh inbox"/);
		assert.doesNotMatch(html, /aria-busy/);
	});

	it("spins and disables while refreshing", () => {
		const html = render({ state: "refreshing" });
		assert.equal(stateOf(html), "refreshing");
		assert.match(html, /disabled=""/);
		assert.match(html, /aria-busy="true"/);
		assert.match(html, /aria-label="Refresh inbox — refreshing"/);
	});

	it("shows a quiet dot for new mail only at rest", () => {
		const idle = render({ hasUpdate: true });
		assert.match(idle, /aria-label="Refresh inbox — new mail"/);
		assert.match(idle, /bg-accent-2/);

		const refreshing = render({ state: "refreshing", hasUpdate: true });
		assert.doesNotMatch(refreshing, /bg-accent-2/);
	});

	it("confirms success without claiming a failure", () => {
		const html = render({ state: "success" });
		assert.equal(stateOf(html), "success");
		assert.match(html, /aria-label="Refresh inbox — up to date"/);
	});

	it("names what failed in the tooltip and the accessible name, never silently", () => {
		const html = render({
			state: "error",
			errorMessage: "Could not reach the server",
		});
		assert.equal(stateOf(html), "error");
		assert.match(
			html,
			/aria-label="Refresh inbox — failed: Could not reach the server"/,
		);
		assert.match(html, /title="Could not reach the server"/);
	});

	it("stays clickable on error so the same action can retry", () => {
		const html = render({ state: "error", errorMessage: "Offline" });
		assert.doesNotMatch(html, /disabled=""/);
	});
});
