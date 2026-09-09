/**
 * The stopped-import screen tells the reader one story (#1147).
 *
 * Title, subtitle and primary action were written three times over and merged
 * out of order, leaving a screen that said the import stopped part-way, then
 * that nothing was written, and offered to retry "the rest". Whichever half a
 * reader believed, the other one was there to contradict it. What is pinned
 * here is agreement: the three strings answer the same question the same way,
 * and no section carries a tick the report cannot vouch for.
 */

import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import type { RemitImapConfigImportReport } from "@remit/api-http-client/types.gen.ts";
import { createElement } from "react";
import { sectionResults, writeFailure } from "../../lib/config-import";
import { createDomHarness, type DomHarness } from "../../test-support/dom";
import {
	nothingLandedImportReport,
	partialImportReport,
} from "./config-import.fixtures";
import { StepPartialImport } from "./steps";

let harness: DomHarness | undefined;

afterEach(() => {
	harness?.close();
	harness = undefined;
});

const renderReport = (report: RemitImapConfigImportReport): DomHarness => {
	const mounted = createDomHarness();
	mounted.render(
		createElement(StepPartialImport, {
			results: sectionResults(report),
			message: writeFailure(report)?.message ?? "",
			raw: `import_write_failed: ${writeFailure(report)?.message ?? ""}`,
			nothingLanded: !report.applied,
		}),
	);
	return mounted;
};

const heading = (mounted: DomHarness): string =>
	mounted.query("h1")?.textContent ?? "";

const subtitle = (mounted: DomHarness): string =>
	mounted.query("h1 + p")?.textContent ?? "";

const primaryAction = (mounted: DomHarness): string => {
	const footer = mounted.query("[data-testid=wizard-footer]");
	assert.ok(footer, "the step renders a footer");
	const buttons = [...footer.querySelectorAll("button")];
	const last = buttons[buttons.length - 1];
	assert.ok(last, "the footer offers an action");
	return last.textContent ?? "";
};

const ticked = (mounted: DomHarness): number => {
	const body = mounted.query("[data-testid=wizard-body]");
	assert.ok(body, "the step renders a report body");
	return body.querySelectorAll('[class*="bg-positive"]').length;
};

describe("the screen for an import that stopped", () => {
	it("says nothing landed in all three places, and never part-way", () => {
		harness = renderReport(nothingLandedImportReport);

		assert.equal(heading(harness), "The import stopped, and nothing landed");
		assert.equal(subtitle(harness), "No section of the file was written.");
		assert.equal(primaryAction(harness), "Try the import again");
		assert.ok(
			!harness.text().includes("part-way"),
			"a screen that says nothing landed cannot also say the import got part of the way",
		);
		assert.ok(
			!harness.text().includes("Retry the rest"),
			'"the rest" claims the file has a part already here',
		);
		assert.equal(ticked(harness), 0, "no section may carry a tick");
	});

	it("counts what landed when the server says some of it did", () => {
		harness = renderReport(partialImportReport);

		assert.equal(heading(harness), "The import stopped part-way");
		assert.equal(subtitle(harness), "2 of 5 sections landed.");
		assert.equal(primaryAction(harness), "Retry the rest");
		assert.equal(ticked(harness), 2, "the landed sections keep their ticks");
	});
});
