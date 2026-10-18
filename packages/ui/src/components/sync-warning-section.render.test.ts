import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { syncWarningDemoEntries } from "./sync-warning-fixtures.js";
import { SyncWarningSection } from "./sync-warning-section.js";

describe("SyncWarningSection", () => {
	it("states the total when the list is capped", () => {
		const html = renderToString(
			createElement(SyncWarningSection, {
				entries: syncWarningDemoEntries,
				total: 4812,
				onReport: () => {},
			}),
		);
		assert.match(html, /Showing the 2 newest of 4812/);
	});
});
