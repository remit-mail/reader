import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { syncWarningDemoEntries } from "./sync-warning-fixtures.js";
import { formatSyncWarningReport } from "./sync-warning-report.js";
import { SyncWarningSection } from "./sync-warning-section.js";

const noop = () => {};
const [gaveUp, retrying] = syncWarningDemoEntries;

describe("SyncWarningSection", () => {
	it("says nothing failed rather than rendering an empty list", () => {
		const html = renderToString(
			createElement(SyncWarningSection, {
				entries: [],
				total: 0,
				onReport: noop,
			}),
		);
		assert.match(html, /Nothing has failed/);
	});

	it("tells a body that gave up from a header still retrying", () => {
		const html = renderToString(
			createElement(SyncWarningSection, {
				entries: [gaveUp, retrying],
				total: 2,
				onReport: noop,
			}),
		);
		assert.match(html, /Gave up/);
		assert.match(html, /Retrying/);
		assert.doesNotMatch(html, /newest of/);
	});

	it("states the total when the list is capped", () => {
		const html = renderToString(
			createElement(SyncWarningSection, {
				entries: [gaveUp, retrying],
				total: 4812,
				onReport: noop,
			}),
		);
		assert.match(html, /Showing the 2 newest of 4812/);
	});
});

describe("formatSyncWarningReport", () => {
	it("carries the stage, state and attempts and never the folder", () => {
		const report = formatSyncWarningReport(gaveUp);
		assert.match(report, /`Body`/);
		assert.match(report, /`GaveUp`/);
		assert.match(report, /Attempts\*\*: 3/);
		assert.doesNotMatch(report, new RegExp(gaveUp.folderLabel));
	});
});
