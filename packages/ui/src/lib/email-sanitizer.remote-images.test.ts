/**
 * Every way an email can name a remote image, and what blocking does to each
 * (#352).
 *
 * `src` on an `<img>` is the obvious one and was the only one the hook rewrote.
 * Three more fetch without a click and none of them are forbidden by config:
 * `srcset` on an `<img>` wins over `src` on any 2x screen, a `<source srcset>`
 * inside a `<picture>` outranks the `<img>` it wraps in every modern browser,
 * and `<video poster>` loads before playback. A blocked or untrusted sender's
 * tracker fires through any of them, so blocking has to close all four.
 *
 * Mounted against jsdom because DOMPurify needs a real DOM.
 */

import "@remit/test-dom";
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { createEmailSanitizer } from "./email-sanitizer.js";

const TRACKER = "https://tracker.example/pixel.png";
const TRACKER_2X = "https://tracker.example/pixel@2x.png";
const POSTER = "https://tracker.example/poster.jpg";

const sanitize = (html: string, allowExternalImages: boolean): string =>
	createEmailSanitizer({ allowExternalImages })(html).html;

// The blocked `<img src>` is deliberately parked in `data-blocked-src` so
// "load once" can restore it. Anywhere else, a tracker URL in the output is a
// fetch the browser will make.
const remoteUrlsOutsideBlockedSrc = (html: string): string[] =>
	[...html.replace(/data-blocked-src="[^"]*"/g, "").matchAll(/https:\/\/\S+/g)]
		.map((match) => match[0])
		.filter((url) => url.includes("tracker.example"));

describe("blocking closes every remote-image vector (#352)", () => {
	test("drops srcset on an img, keeping the placeholder swap", () => {
		const html = sanitize(
			`<img src="${TRACKER}" srcset="${TRACKER_2X} 2x" alt="x" />`,
			false,
		);
		assert.doesNotMatch(html, /srcset/);
		assert.match(html, /data-blocked-src="https:\/\/tracker\.example/);
		assert.match(html, /src="data:image\/svg\+xml/);
		assert.deepEqual(remoteUrlsOutsideBlockedSrc(html), []);
	});

	test("drops srcset on an img whose src is a harmless data URI", () => {
		const html = sanitize(
			`<img src="data:image/gif;base64,R0lGOD" srcset="${TRACKER_2X} 2x" />`,
			false,
		);
		assert.doesNotMatch(html, /srcset/);
		assert.deepEqual(remoteUrlsOutsideBlockedSrc(html), []);
	});

	test("neuters a picture's source, which would otherwise beat the placeholder img", () => {
		const html = sanitize(
			`<picture><source srcset="${TRACKER_2X}" type="image/png" /><img src="${TRACKER}" /></picture>`,
			false,
		);
		assert.doesNotMatch(html, /srcset/);
		assert.deepEqual(remoteUrlsOutsideBlockedSrc(html), []);
	});

	test("neuters a bare source src", () => {
		const html = sanitize(
			`<video><source src="${TRACKER}" type="video/mp4" /></video>`,
			false,
		);
		assert.deepEqual(remoteUrlsOutsideBlockedSrc(html), []);
	});

	test("drops a video poster, which loads before any playback", () => {
		const html = sanitize(`<video poster="${POSTER}"></video>`, false);
		assert.doesNotMatch(html, /poster/);
		assert.deepEqual(remoteUrlsOutsideBlockedSrc(html), []);
	});
});

describe("loading images restores every vector (#352)", () => {
	test("keeps srcset on an img", () => {
		const html = sanitize(
			`<img src="${TRACKER}" srcset="${TRACKER_2X} 2x" alt="x" />`,
			true,
		);
		assert.match(html, /srcset="[^"]*pixel@2x\.png/);
		assert.match(html, /src="https:\/\/tracker\.example\/pixel\.png"/);
		assert.doesNotMatch(html, /data-blocked-src/);
	});

	test("keeps a picture's source srcset", () => {
		const html = sanitize(
			`<picture><source srcset="${TRACKER_2X}" type="image/png" /><img src="${TRACKER}" /></picture>`,
			true,
		);
		assert.match(html, /srcset="[^"]*pixel@2x\.png/);
	});

	test("keeps a source src", () => {
		const html = sanitize(
			`<video><source src="${TRACKER}" type="video/mp4" /></video>`,
			true,
		);
		assert.match(html, /src="https:\/\/tracker\.example\/pixel\.png"/);
	});

	test("keeps a video poster", () => {
		const html = sanitize(`<video poster="${POSTER}"></video>`, true);
		assert.match(html, /poster="https:\/\/tracker\.example\/poster\.jpg"/);
	});
});
