import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import type { BriefCategoryFilter, ThreadSection } from "./app-shell-types.js";
import { BriefSections } from "./brief-sections.js";
import { ComfortableRow } from "./message-row.js";

const sections: ThreadSection[] = [
	{
		id: "personal",
		label: "Personal",
		threads: [
			{
				id: "t1",
				accountId: "a1",
				fromName: "Priya Nair",
				fromEmail: "priya@example.com",
				subject: "Design review tomorrow",
				snippet: "Can we move it to 2pm?",
				timeLabel: "8:15",
				isRead: false,
				category: "personal",
			},
		],
	},
	{
		id: "newsletter",
		label: "Newsletter",
		threads: [
			{
				id: "t2",
				accountId: "a1",
				fromName: "The Weekly Brief",
				fromEmail: "hello@weekly.example",
				subject: "This week in product",
				snippet: "Five stories you missed.",
				timeLabel: "Thu",
				isRead: true,
				category: "newsletter",
			},
		],
	},
];

function render(briefCategory: BriefCategoryFilter) {
	return renderToString(
		createElement(BriefSections, {
			sections,
			Row: ComfortableRow,
			briefCategory,
			onSelectThread: () => undefined,
			onSelectBriefCategory: () => undefined,
		}),
	);
}

describe("BriefSections", () => {
	it("renders section labels and rows", () => {
		const html = render("all");
		assert.match(html, /Personal/);
		assert.match(html, /Newsletter/);
		assert.match(html, /Priya Nair/);
		assert.match(html, /Weekly Brief/);
	});

	it("filters rows by briefCategory", () => {
		const html = render("newsletter");
		assert.match(html, /Weekly Brief/);
		assert.doesNotMatch(html, /Priya Nair/);
	});

	// #312: a section the server answered for is a section, rows or not. Dropping
	// it would leave the reader unable to tell a chip that matched nothing from a
	// category the brief never asked about.
	it("keeps a counted section a chip narrowed to nothing", () => {
		const html = renderToString(
			createElement(BriefSections, {
				sections: [
					{
						id: "personal",
						label: "Personal",
						threads: [],
						total: { kind: "exact", value: 4753 },
					},
				],
				Row: ComfortableRow,
				briefCategory: "all",
				onSelectThread: () => undefined,
				onSelectBriefCategory: () => undefined,
			}),
		);
		assert.match(html, /No Personal mail in this brief\./);
	});

	// A search is answered by one ordered list. Sectioning the matches would put
	// an old newsletter above a newer match, which is what the sections do (#312).
	it("renders no headers at all under `flat`, keeping the given row order", () => {
		const html = renderToString(
			createElement(BriefSections, {
				sections,
				Row: ComfortableRow,
				briefCategory: "all",
				flat: true,
				onSelectThread: () => undefined,
				onSelectBriefCategory: () => undefined,
			}),
		);
		assert.doesNotMatch(html, />Personal</);
		assert.doesNotMatch(html, />Newsletter</);
		assert.ok(
			html.indexOf("Priya Nair") < html.indexOf("Weekly Brief"),
			"the flat list reordered its rows",
		);
	});

	// Narrowed to one category the label repeats the chip, but the total does
	// not: it is the only statement of how much mail that category holds.
	it("keeps the header at a single-category scope once it carries a total", () => {
		const html = renderToString(
			createElement(BriefSections, {
				sections: [
					{
						id: "newsletter",
						label: "Newsletter",
						threads: sections[1].threads,
						total: { kind: "exact", value: 2295 },
					},
				],
				Row: ComfortableRow,
				briefCategory: "newsletter",
				onSelectThread: () => undefined,
				onSelectBriefCategory: () => undefined,
			}),
		);
		assert.match(html, /Newsletter/);
		assert.match(html, />2,295</);
	});
});
