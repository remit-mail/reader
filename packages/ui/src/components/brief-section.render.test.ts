/**
 * The section header states its category's size, not its page's length (#312).
 *
 * The number used to be `section.threads.length` — how many of one shared 50-row
 * window happened to be Marketing, rendered where a category total belongs. The
 * cases below pin the two halves apart: a total that does not move when the rows
 * do, and the shapes the component must refuse — a real total above no rows, and
 * a number invented for a section nobody counted.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import type { ThreadRowData, ThreadSection } from "./app-shell-types.js";
import { BriefSection, SECTION_ROW_CAP } from "./brief-section.js";
import type { ResultCount } from "./list-result-header.js";
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

interface Props {
	count: number;
	total?: ResultCount;
	loading?: boolean;
	label?: string;
	initialExpanded?: boolean;
	initialCollapsed?: boolean;
	showAll?: boolean;
}

function section(props: Props): ThreadSection {
	return {
		id: "personal",
		label: props.label ?? "Personal",
		threads: Array.from({ length: props.count }, (_, i) => makeRow(i + 1)),
		total: props.total,
		loading: props.loading,
	};
}

function render(props: Props): string {
	return renderToString(
		createElement(BriefSection, {
			section: section(props),
			Row: ComfortableRow,
			initialExpanded: props.initialExpanded,
			initialCollapsed: props.initialCollapsed,
			onShowAll: props.showAll ? () => undefined : undefined,
			onSelectThread: () => undefined,
		}),
	);
}

function rowCount(html: string): number {
	return (html.match(/Subject \d+/g) ?? []).length;
}

const exact = (value: number): ResultCount => ({ kind: "exact", value });

describe("BriefSection", () => {
	it("renders the section label and the server's total for its category", () => {
		const html = render({ count: 3, total: exact(4753) });
		assert.match(html, /Personal/);
		assert.match(html, />4,753</);
	});

	it("states the same total however many rows are loaded", () => {
		const ten = render({ count: SECTION_ROW_CAP, total: exact(3942) });
		const three = render({ count: 3, total: exact(3942) });
		assert.match(ten, />3,942</);
		assert.match(three, />3,942</);
		assert.doesNotMatch(ten, />10</, "the header fell back to the page length");
	});

	it("renders no number for a section nobody counted", () => {
		const html = render({ count: 3 });
		assert.match(html, /Personal/);
		assert.doesNotMatch(html, />3</, "an uncounted section reported a size");
	});

	it("renders no number when the server withheld the count", () => {
		const html = render({ count: 3, total: { kind: "unknown" } });
		assert.doesNotMatch(html, />3</);
	});

	it("shows every row and no control below the cap", () => {
		const html = render({ count: SECTION_ROW_CAP });
		assert.strictEqual(rowCount(html), SECTION_ROW_CAP);
		assert.doesNotMatch(html, /Show \d+ more/);
		assert.doesNotMatch(html, /Show less/);
	});

	it("offers the whole category when the total runs past the loaded rows", () => {
		const html = render({
			count: SECTION_ROW_CAP,
			total: exact(3942),
			showAll: true,
		});
		assert.strictEqual(rowCount(html), SECTION_ROW_CAP);
		assert.match(html, />3,942</, "the header lost the category total");
		assert.match(html, /Show all 3,942/);
	});

	it("offers nothing beyond the rows when they are the whole category", () => {
		const html = render({ count: 3, total: exact(3), showAll: true });
		assert.doesNotMatch(html, /Show all/);
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

	it("renders rows by default — sections start expanded", () => {
		const html = render({ count: 3 });
		assert.strictEqual(rowCount(html), 3);
	});

	it("keeps the total when the reader collapses the section", () => {
		const html = render({
			count: 18,
			total: exact(18),
			initialCollapsed: true,
		});
		assert.match(html, /Personal/);
		assert.match(html, />18</);
		assert.strictEqual(rowCount(html), 0);
		assert.doesNotMatch(html, /Show \d+ more/);
		assert.doesNotMatch(html, /Show less/);
	});

	it("makes the header a button with aria-expanded so it toggles the section", () => {
		const expandedHtml = render({ count: 3 });
		assert.match(expandedHtml, /<button[^>]*aria-expanded="true"/);
		const collapsedHtml = render({ count: 3, initialCollapsed: true });
		assert.match(collapsedHtml, /<button[^>]*aria-expanded="false"/);
	});

	// The shape #312 rejected outright: `Marketing 3,942` above nothing at all,
	// which reads as a broken list rather than as a filter that matched nothing.
	it("never states a total above no rows", () => {
		const html = render({ count: 0, total: exact(3942), label: "Marketing" });
		assert.doesNotMatch(html, />3,942</);
		assert.match(html, /No Marketing mail in this brief\./);
	});

	it("shows the loading treatment, and its total, while the rows are in flight", () => {
		const html = render({ count: 0, total: exact(3942), loading: true });
		assert.match(html, />3,942</);
		assert.doesNotMatch(html, /No Personal mail in this brief\./);
		assert.match(html, /animate-pulse/);
	});

	// D6 / issue #45: unclassified mail is its own section with its own label,
	// never folded into Personal.
	it("renders the unclassified section under its own label", () => {
		const html = render({ count: 2, label: "Unclassified", total: exact(2) });
		assert.match(html, /Unclassified/);
		assert.doesNotMatch(html, /Personal/);
	});
});
