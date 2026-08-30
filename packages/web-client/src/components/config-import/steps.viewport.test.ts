/**
 * A report longer than the screen still leaves the reader somewhere to press.
 *
 * On a 1512×827 laptop the dry run of a real configuration drew taller than the
 * viewport. The wizard sat in a fixed box with nothing scrolling, so "Import n
 * changes" was rendered below the fold with no way to reach it and the import
 * could not be finished at all (#1021).
 *
 * The shape that fixes it is structural, and structure is what this file holds:
 * the growable part of a step lives in its own scroll box, the title and the
 * footer actions sit outside that box, and the shell is capped to the viewport
 * so nothing can push the footer off it. jsdom has no layout engine, so the
 * pixels are pinned by the "long report, short viewport" Storybook stories
 * instead — what is asserted here is the arrangement those stories depend on,
 * which is the part a refactor silently takes away.
 */

import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { createElement } from "react";
import type { ReportSection } from "../../lib/config-import";
import { createDomHarness, type DomHarness } from "../../test-support/dom";
import type { ImportedAccount } from "./steps";
import { StepCredentialsOverview, StepDryRunReport } from "./steps";

let harness: DomHarness | undefined;

afterEach(() => {
	harness?.close();
	harness = undefined;
});

const LONG_REPORT: ReportSection[] = [
	{
		id: "accounts",
		title: "Accounts",
		entries: Array.from({ length: 40 }, (_, index) => ({
			id: `accounts-${index}`,
			label: `mailbox-${index}@example.test`,
			verdict: "created" as const,
		})),
	},
	{
		id: "filters",
		title: "Rules & filters",
		entries: Array.from({ length: 40 }, (_, index) => ({
			id: `filters-${index}`,
			label: `Rule ${index}`,
			verdict: "skipped" as const,
			reason: "The folder this rule files into is not here yet.",
		})),
	},
];

const MANY_ACCOUNTS: ImportedAccount[] = Array.from(
	{ length: 30 },
	(_, index) => ({
		accountId: `acct-${index}`,
		address: `mailbox-${index}@example.test`,
		displayName: `Mailbox ${index}`,
		connector: "imap" as const,
		server: "imap.example.test",
		state: "needed" as const,
	}),
);

const classes = (element: Element): string[] =>
	(element.getAttribute("class") ?? "").split(/\s+/).filter(Boolean);

const shellOf = (mounted: DomHarness): Element => {
	const body = mounted.query("[data-testid=wizard-body]");
	assert.ok(body, "the step renders a wizard body region");
	const shell = body.closest("div.h-dvh");
	assert.ok(shell, "the wizard body sits inside the shell root");
	return shell;
};

const FOCUSABLE =
	'a[href], button, input, select, textarea, [tabindex]:not([tabindex="-1"])';

describe("a wizard step longer than the viewport (#1021)", () => {
	it("puts the whole report inside the scroll box and the footer outside it", () => {
		harness = createDomHarness({ viewportWidth: 1512 });
		harness.render(
			createElement(StepDryRunReport, {
				sections: LONG_REPORT,
				fileName: "reader-config.example.json",
			}),
		);

		const body = harness.query("[data-testid=wizard-body]");
		const footer = harness.query("[data-testid=wizard-footer]");
		assert.ok(body && footer);

		// The rail above the card renders a list item per step, so the count is
		// the assertion: all 80 report rows are inside the scroll box, and a row
		// left outside it would show up as a shortfall here.
		assert.equal(
			body.querySelectorAll("li").length,
			80,
			"every report row grows inside the scroll box",
		);

		assert.ok(
			!body.contains(footer),
			"the footer sits outside the scroll box, so the report cannot scroll it away",
		);
		const primary = harness.byText("button", "Import");
		assert.ok(
			footer.contains(primary),
			"the primary action lives in the footer",
		);
	});

	it("scrolls the body and never the shell", () => {
		harness = createDomHarness({ viewportWidth: 1512 });
		harness.render(
			createElement(StepDryRunReport, {
				sections: LONG_REPORT,
				fileName: "reader-config.example.json",
			}),
		);

		const body = harness.query("[data-testid=wizard-body]");
		assert.ok(body);
		const bodyClasses = classes(body);
		assert.ok(
			bodyClasses.includes("overflow-y-auto"),
			"the body region is the scrolling element",
		);
		assert.ok(
			bodyClasses.includes("min-h-0"),
			"the body region can shrink below its content, or it never scrolls",
		);

		const shell = shellOf(harness);
		assert.ok(
			classes(shell).includes("overflow-hidden"),
			"the shell root does not scroll — the footer would ride out of view with it",
		);
		assert.deepEqual(
			harness
				.queryAll('[class*="overflow-y-auto"]')
				.map((element) => element.getAttribute("data-testid")),
			["wizard-body"],
			"exactly one region scrolls, and it is the one holding the growable content",
		);
	});

	it("caps the shell at the viewport rather than growing past it", () => {
		harness = createDomHarness({ viewportWidth: 1512 });
		harness.render(
			createElement(StepDryRunReport, {
				sections: LONG_REPORT,
				fileName: "reader-config.example.json",
			}),
		);

		const shellClasses = classes(shellOf(harness));
		assert.ok(
			shellClasses.includes("h-dvh"),
			"the shell is exactly the viewport, so no content length can extend it",
		);
		assert.ok(
			!shellClasses.some((token) => token.startsWith("min-h-")),
			"a minimum height would let the content push the shell past the fold again",
		);
	});

	it("keeps the footer action last in the tab order", () => {
		harness = createDomHarness({ viewportWidth: 1512 });
		harness.render(
			createElement(StepDryRunReport, {
				sections: LONG_REPORT,
				fileName: "reader-config.example.json",
			}),
		);

		const footer = harness.query("[data-testid=wizard-footer]");
		assert.ok(footer);
		const focusable = harness.queryAll(FOCUSABLE);
		assert.ok(focusable.length >= 2, "the step has controls to tab through");
		assert.ok(
			focusable.every((element) => {
				const order = element.getAttribute("tabindex");
				return order === null || Number.parseInt(order, 10) <= 0;
			}),
			"nothing claims a positive tabindex, so DOM order is the tab order",
		);
		const last = focusable[focusable.length - 1];
		assert.ok(
			last && footer.contains(last),
			"tabbing forward through the report ends on the footer action",
		);
	});

	it("holds the same shape for a long list of accounts needing credentials", () => {
		harness = createDomHarness({ viewportWidth: 1512 });
		harness.render(
			createElement(StepCredentialsOverview, { accounts: MANY_ACCOUNTS }),
		);

		const body = harness.query("[data-testid=wizard-body]");
		const footer = harness.query("[data-testid=wizard-footer]");
		assert.ok(body && footer);
		assert.equal(
			body.querySelectorAll("li").length,
			MANY_ACCOUNTS.length,
			"the account list grows inside the scroll box",
		);
		assert.ok(
			footer.contains(harness.byText("button", "Finish later")),
			"the way on stays pinned however many accounts the file carried",
		);
	});
});
