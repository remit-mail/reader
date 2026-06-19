import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { RowActions } from "./row-actions.js";

describe("RowActions", () => {
	it("renders secondary actions as buttons, never disabled", () => {
		const html = renderToString(
			createElement(RowActions, {
				actions: [
					{ label: "Manage", onClick: () => undefined },
					{
						label: "Reconnect",
						variant: "secondary",
						onClick: () => undefined,
					},
				],
			}),
		);
		assert.match(html, /Manage/);
		assert.match(html, /Reconnect/);
		assert.doesNotMatch(html, /disabled=""/);
	});

	it("renders the destructive action as a real button with no disabled attribute", () => {
		const html = renderToString(
			createElement(RowActions, {
				destructive: {
					label: "Delete",
					iconOnly: true,
					onClick: () => undefined,
					confirm: { prompt: "Delete this account?" },
				},
			}),
		);
		assert.match(html, /<button/);
		assert.match(html, /aria-label="Delete"/);
		assert.doesNotMatch(html, /disabled=""/);
	});

	it("uses aria-busy, not disabled, while an action is busy", () => {
		const html = renderToString(
			createElement(RowActions, {
				actions: [
					{
						label: "Reconnect",
						variant: "secondary",
						busy: true,
						busyLabel: "Redirecting…",
						onClick: () => undefined,
					},
				],
			}),
		);
		assert.match(html, /aria-busy="true"/);
		assert.match(html, /Redirecting/);
		assert.match(html, /animate-spin/);
		assert.doesNotMatch(html, /disabled=""/);
	});

	it("renders an icon-only destructive action with an accessible label", () => {
		const html = renderToString(
			createElement(RowActions, {
				actions: [
					{
						label: "Retry sending",
						iconOnly: true,
						onClick: () => undefined,
					},
				],
				destructive: {
					label: "Delete message",
					iconOnly: true,
					onClick: () => undefined,
				},
			}),
		);
		assert.match(html, /aria-label="Retry sending"/);
		assert.match(html, /aria-label="Delete message"/);
		assert.doesNotMatch(html, /disabled=""/);
	});
});
