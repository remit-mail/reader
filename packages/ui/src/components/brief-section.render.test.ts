import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import type { ThreadRowData, ThreadSection } from "./app-shell-types.js";
import { BriefSection, SECTION_ROW_CAP } from "./brief-section.js";
import { ComfortableRow } from "./message-row.js";

function makeRow(i: number): ThreadRowData {
	return {
		id: `t${i}`,
		accountId: "a1",
		fromName: `Sender ${i}`,
		fromEmail: `sender${i}@example.com`,
		subject: `Subject ${i}`,
		snippet: "Preview",
		timeLabel: "9:00",
		isRead: false,
		category: "personal",
	};
}

function section(count: number): ThreadSection {
	return {
		id: "personal",
		label: "Personal",
		threads: Array.from({ length: count }, (_, i) => makeRow(i + 1)),
	};
}

function render(props: { count: number; initialExpanded?: boolean }): string {
	return renderToString(
		createElement(BriefSection, {
			section: section(props.count),
			Row: ComfortableRow,
			initialExpanded: props.initialExpanded,
			onSelectThread: () => undefined,
		}),
	);
}

function rowCount(html: string): number {
	return (html.match(/Subject \d+/g) ?? []).length;
}

describe("BriefSection", () => {
	it("renders the section label and a row count", () => {
		const html = render({ count: 3 });
		assert.match(html, /Personal/);
		assert.match(html, />3</);
	});

	it("shows every row and no expander below the cap", () => {
		const html = render({ count: SECTION_ROW_CAP });
		assert.strictEqual(rowCount(html), SECTION_ROW_CAP);
		assert.doesNotMatch(html, /Show \d+ more/);
		assert.doesNotMatch(html, /Show less/);
	});

	it("caps at SECTION_ROW_CAP with a 'Show N more' control over the cap", () => {
		const html = render({ count: 18 });
		assert.strictEqual(rowCount(html), SECTION_ROW_CAP);
		assert.match(html, new RegExp(`Show ${18 - SECTION_ROW_CAP} more`));
	});

	it("reveals every row and offers 'Show less' when expanded", () => {
		const html = render({ count: 18, initialExpanded: true });
		assert.strictEqual(rowCount(html), 18);
		assert.match(html, /Show less/);
		assert.doesNotMatch(html, /Show \d+ more/);
	});
});
