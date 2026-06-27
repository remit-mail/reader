/**
 * React-render smoke test for `BlockedImagesNotice` — the privacy "images
 * blocked" bar extracted from `MessageBody`. Pins the never-disable-buttons
 * rule (#943): the "Always trust" button stays active while the trust toggle
 * is in flight. It must NOT render `disabled`; the in-flight state is reflected
 * via `aria-busy` and a pending label instead, so the control stays focusable
 * and clickable (the handler no-ops the second click on the consumer side).
 *
 * Uses `react-dom/server`'s `renderToString` so the assertion runs without
 * jsdom/happy-dom (no new deps), matching `MessageBodyErrorBanner.render.test`.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { BlockedImagesNotice } from "./BlockedImagesNotice";

const noop = () => undefined;

const render = (
	overrides: Partial<Parameters<typeof BlockedImagesNotice>[0]>,
) =>
	renderToString(
		createElement(BlockedImagesNotice, {
			blockedImageCount: 3,
			canAlwaysTrust: true,
			isTrustPending: false,
			onLoadOnce: noop,
			onAlwaysTrust: noop,
			...overrides,
		}) as never,
	);

const alwaysTrustButton = (html: string): string | undefined =>
	html.match(/<button\b[^>]*>(?:Always trust|Trusting…)<\/button>/)?.[0];

describe("BlockedImagesNotice — never-disable the Always trust button (#943)", () => {
	it("renders the Always trust button active when not pending", () => {
		const html = render({ isTrustPending: false });
		const btn = alwaysTrustButton(html);
		assert.ok(btn, "Always trust button should render");
		assert.doesNotMatch(btn, /\bdisabled\b/);
		assert.match(btn, /Always trust/);
	});

	it("keeps the Always trust button NOT disabled while pending, reflecting state via aria-busy + label", () => {
		const html = render({ isTrustPending: true });
		const btn = alwaysTrustButton(html);
		assert.ok(btn, "Always trust button should still render while pending");
		assert.doesNotMatch(
			btn,
			/\bdisabled\b/,
			"never disable the button — pending must not gray it out (#943)",
		);
		assert.match(btn, /aria-busy="true"/);
		assert.match(btn, /Trusting…/);
	});

	it("hides the Always trust button when the sender can't be trusted", () => {
		const html = render({ canAlwaysTrust: false });
		assert.equal(alwaysTrustButton(html), undefined);
		assert.match(html, /<button\b[^>]*>Load once<\/button>/);
	});
});
