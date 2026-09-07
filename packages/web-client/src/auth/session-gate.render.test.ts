/**
 * #441: a 429 on the session lookup put the sign-in screen up, so a throttled
 * instance told everyone behind the address they had been logged out. This
 * renders the gate the app actually mounts, one state per case.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { SessionGate } from "./BetterAuthShell";
import type { SessionQuery } from "./session-state";

const APP = "the-signed-in-app";

const render = (session: SessionQuery): string =>
	renderToString(
		createElement(SessionGate, {
			session,
			onRetry: () => undefined,
			// biome-ignore lint/correctness/noChildrenProp: no JSX in a `.ts` test, and createElement's variadic children do not satisfy a required prop
			children: APP,
		}) as never,
	);

const tooManyRequests = {
	status: 429,
	statusText: "Too Many Requests",
	error: { message: "Too many requests. Please try again later." },
};

describe("the session gate", () => {
	it("shows the app when a session is held", () => {
		const html = render({
			data: { user: { id: "u1" } },
			isPending: false,
			error: null,
		});
		assert.match(html, new RegExp(APP));
	});

	it("shows the sign-in screen when the lookup answered without a session", () => {
		const html = render({ data: null, isPending: false, error: null });
		assert.match(html, /Sign in/);
		assert.doesNotMatch(html, /Too many requests/i);
	});

	it("names the rate limit instead of claiming a sign-out", () => {
		const html = render({
			data: null,
			isPending: false,
			error: tooManyRequests,
		});
		assert.match(html, /Too many requests from this address/i);
		assert.match(html, /have not been signed out/i);
		assert.doesNotMatch(html, /Create account/);
	});

	it("offers a way to retry and a way to report", () => {
		const html = render({
			data: null,
			isPending: false,
			error: tooManyRequests,
		});
		assert.match(html, /Try again/);
		assert.match(html, /Report an issue/);
	});

	it("announces the refusal rather than leaving it to colour", () => {
		const html = render({
			data: null,
			isPending: false,
			error: tooManyRequests,
		});
		assert.match(html, /role="alert"/);
	});
});
