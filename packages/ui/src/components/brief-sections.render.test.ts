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
});
