/**
 * Image gating at the `MessageBody` seam (#352). `BlockedFlag` declares that a
 * blocked sender's images never load "even on explicit click", and Settings >
 * Senders promises the same. Blocked therefore suppresses auto-load AND removes
 * the manual load affordances, and outranks `trusted` when both are set.
 *
 * Renders through the real pipeline — sanitizer, blocked-image count, notice —
 * against the jsdom harness, so the assertions read the DOM the user gets.
 */

import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { createElement } from "react";
import { createDomHarness, type DomHarness } from "../../test-support/dom";
import { MessageBody } from "./MessageBody";

let harness: DomHarness | undefined;

// The sandboxed frame measures itself once the iframe loads. jsdom fires that
// load but has no ResizeObserver, and the resulting ReferenceError is raised
// inside a listener where no assertion can see it.
(globalThis as { ResizeObserver?: unknown }).ResizeObserver = class {
	observe() {}
	unobserve() {}
	disconnect() {}
};

afterEach(() => {
	harness?.close();
	harness = undefined;
});

const MARKETING_HTML = `
<div>
	<img src="https://tracker.example/hero.png" alt="Hero" />
	<p>Up to 40% off everything this weekend.</p>
	<img src="https://tracker.example/pixel.gif" alt="" />
</div>
`;

// Every remote-image vector an email can reach for, not just `img src`.
const MULTI_VECTOR_HTML = `
<div>
	<img src="https://tracker.example/hero.png" srcset="https://tracker.example/hero@2x.png 2x" alt="Hero" />
	<picture>
		<source srcset="https://tracker.example/wide.png" type="image/png" />
		<img src="https://tracker.example/narrow.png" alt="Deal" />
	</picture>
	<video poster="https://tracker.example/poster.jpg"><source src="https://tracker.example/clip.mp4" type="video/mp4" /></video>
</div>
`;

const mount = (
	flags: { isTrusted?: boolean; isBlocked?: boolean },
	overrides: { html?: string; messageId?: string } = {},
) => {
	harness = createDomHarness();
	harness.renderApp(
		createElement(MessageBody, {
			html: MARKETING_HTML,
			messageId: "msg-1",
			fromAddressId: "addr-1",
			category: "marketing",
			...flags,
			...overrides,
		}),
	);
	return harness;
};

const rerender = (
	dom: DomHarness,
	flags: { isTrusted?: boolean; isBlocked?: boolean },
	overrides: { html?: string; messageId?: string } = {},
) => {
	dom.renderApp(
		createElement(MessageBody, {
			html: MARKETING_HTML,
			messageId: "msg-1",
			fromAddressId: "addr-1",
			category: "marketing",
			...flags,
			...overrides,
		}),
	);
};

const frameHtml = (dom: DomHarness): string =>
	dom.query<HTMLIFrameElement>("iframe")?.getAttribute("srcdoc") ?? "";

// A blocked image keeps its original URL in `data-blocked-src` — only a live
// `src=` means the browser will fetch it.
const REMOTE_SRC = /\ssrc="https:\/\/tracker\.example\/hero\.png"/;

describe("MessageBody image gating — blocked senders (#352)", () => {
	it("never auto-loads images for a blocked sender", () => {
		const dom = mount({ isBlocked: true });
		assert.match(
			frameHtml(dom),
			/data-blocked-src/,
			"a blocked sender's remote images must stay placeholders",
		);
		assert.doesNotMatch(frameHtml(dom), REMOTE_SRC);
	});

	it("offers no manual load affordance for a blocked sender", () => {
		const dom = mount({ isBlocked: true });
		assert.equal(
			dom.queryAll("button").length,
			0,
			"never load, even on explicit click — the controls are absent, not disabled",
		);
		assert.doesNotMatch(dom.html(), /\bdisabled\b/);
	});

	it("says why the message has no images instead of going quiet", () => {
		const dom = mount({ isBlocked: true });
		assert.match(dom.text(), /2 images hidden/);
		assert.match(dom.text(), /you blocked this sender/);
	});

	it("keeps images blocked when the sender is both blocked and trusted", () => {
		const dom = mount({ isBlocked: true, isTrusted: true });
		assert.match(frameHtml(dom), /data-blocked-src/);
		assert.equal(dom.queryAll("button").length, 0);
		assert.match(dom.text(), /you blocked this sender/);
	});

	it("emits no fetchable tracker URL through srcset, picture or poster either", () => {
		const dom = mount({ isBlocked: true }, { html: MULTI_VECTOR_HTML });
		// The placeholder swap parks the original `img src` in
		// `data-blocked-src` for "load once"; anywhere else in the srcdoc, a
		// tracker URL is a request the frame will make.
		const live = frameHtml(dom).replace(/data-blocked-src="[^"]*"/g, "");
		assert.doesNotMatch(
			live,
			/tracker\.example/,
			"blocked means no remote image request, whichever attribute names it",
		);
		assert.match(
			frameHtml(dom),
			/data-blocked-src="https:\/\/tracker\.example/,
		);
	});
});

describe("MessageBody load-once is scoped to one message (#352)", () => {
	it("drops the grant when the same instance is handed a different message", () => {
		const dom = mount({});
		dom.click(dom.byText("button", "Load once"));
		assert.match(frameHtml(dom), REMOTE_SRC);

		rerender(dom, {}, { messageId: "msg-2" });

		assert.doesNotMatch(
			frameHtml(dom),
			REMOTE_SRC,
			"a load-once decision belongs to the message it was taken on",
		);
		assert.match(frameHtml(dom), /data-blocked-src/);
		assert.ok(dom.byText("button", "Load once"));
	});

	it("keeps the grant while the message stays the same", () => {
		const dom = mount({});
		dom.click(dom.byText("button", "Load once"));
		rerender(dom, { isTrusted: false });
		assert.match(frameHtml(dom), REMOTE_SRC);
	});
});

describe("MessageBody image gating — the states blocking must not change", () => {
	it("auto-loads a trusted sender's images and shows no notice", () => {
		const dom = mount({ isTrusted: true });
		assert.match(frameHtml(dom), REMOTE_SRC);
		assert.doesNotMatch(frameHtml(dom), /data-blocked-src/);
		assert.doesNotMatch(dom.text(), /hidden|blocked for privacy/);
	});

	it("still offers Load once and Always trust to a merely untrusted sender", () => {
		const dom = mount({});
		assert.match(frameHtml(dom), /data-blocked-src/);
		assert.match(dom.text(), /2 images blocked for privacy/);
		assert.ok(dom.byText("button", "Load once"));
		assert.ok(dom.byText("button", "Always trust"));
	});

	it("loads the images once the untrusted sender's Load once is taken", () => {
		const dom = mount({});
		dom.click(dom.byText("button", "Load once"));
		assert.match(frameHtml(dom), REMOTE_SRC);
	});
});
