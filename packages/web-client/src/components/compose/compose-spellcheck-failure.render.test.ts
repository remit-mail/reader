/**
 * The failure path of #707, end to end: a checker that will not start has to
 * say so on screen. Each link in that chain is covered on its own elsewhere —
 * what is asserted here is that they are actually joined, because every break
 * in it looks identical from the writer's seat. A composer with no squiggles
 * reads as a message with nothing wrong in it, and that is the one thing it
 * must never come to mean by accident.
 */

import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import type { ComposeBody as ComposeBodyType } from "@remit/ui/rich-text";
import { createElement, useMemo } from "react";
import { createDomHarness, type DomHarness } from "../../test-support/dom";
import { useErrorBanners } from "../ui/ErrorBannerProvider";
import { composeSpellcheck } from "./compose-spellcheck.js";

let harness: DomHarness | undefined;
let ComposeBody: typeof ComposeBodyType;

class Marks {
	readonly ranges: Range[] = [];
	add(range: Range): void {
		this.ranges.push(range);
	}
}

const FAILURE = "the worker could not be started";

before(async () => {
	// The marks are drawn through the CSS Custom Highlight registry, which jsdom
	// has neither half of. Without both the editor draws nothing and opens no
	// provider at all, so there would be no failure to observe.
	Object.defineProperty(globalThis, "CSS", {
		value: { highlights: new Map<string, Marks>() },
		configurable: true,
	});
	Object.defineProperty(globalThis, "Highlight", {
		value: Marks,
		configurable: true,
	});
	harness = createDomHarness();
	// remit-ui's `.tsx` is transpiled here with the classic JSX runtime, which
	// reads a global `React`. The harness installs it, so the editor is pulled
	// in after one exists rather than at import time.
	({ ComposeBody } = await import("@remit/ui/rich-text"));
});

after(() => {
	harness?.close();
	harness = undefined;
});

/**
 * The composer as `ComposeForm` wires it — the app's own options object, with
 * only the module load behind the provider swapped for one that fails the way
 * a missing chunk does.
 */
const Composer = () => {
	const { pushError } = useErrorBanners();
	const spellcheck = useMemo(
		() => ({
			...composeSpellcheck(pushError),
			provider: () => Promise.reject(new Error(FAILURE)),
		}),
		[pushError],
	);
	return createElement(ComposeBody, {
		mode: "rich",
		onModeChange: () => undefined,
		initialHtml: "<p>Ths is redy.</p>",
		initialText: "Ths is redy.",
		onChange: () => undefined,
		onConversionError: () => undefined,
		onLanguageChange: () => undefined,
		languages: ["en"],
		spellcheck,
	});
};

const mounted = (): DomHarness => {
	if (!harness) throw new Error("the harness is not mounted");
	return harness;
};

describe("a checker the composer cannot start", () => {
	it("says what stopped, offers the report, and gives the message back", async () => {
		mounted().renderApp(createElement(Composer));
		await mounted().flush();

		const banner = mounted().query('[aria-label="Notifications"]');
		assert.ok(
			banner,
			"a checker that failed to start is on screen, not silent",
		);
		assert.match(banner.textContent ?? "", /Spellcheck stopped/);
		assert.match(banner.textContent ?? "", /Spellcheck for en is off/);
		assert.match(banner.textContent ?? "", /checker stopped running/);

		const report = banner.querySelector<HTMLAnchorElement>("a[href]");
		assert.ok(report, "the failure carries a way to report it");
		const href = new URL(report.href);
		assert.match(href.href, /github\.com\/.+\/issues\/new\?/);
		assert.match(href.searchParams.get("body") ?? "", new RegExp(FAILURE));

		const editable = mounted().query("[data-testid=compose-body]");
		assert.ok(editable, "the writing surface is mounted");
		assert.equal(
			editable.getAttribute("spellcheck"),
			"true",
			"the browser checks the message when ours cannot",
		);
	});
});
