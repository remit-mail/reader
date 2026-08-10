import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import type { IntelligenceData } from "./intelligence-panel.js";
import { IntelligencePanel } from "./intelligence-panel.js";

const vipWithFailingAuthenticity: IntelligenceData = {
	sender: {
		name: "Sabrina Basten",
		email: "sabrina@sabrinabasten.example",
		trust: "vip",
		firstSeenLabel: "Mar 2023",
		inboundCount: 214,
		replyCount: 188,
	},
	authenticity: {
		verdict: "mismatch",
		fromDomain: "sabrinabasten.example",
		dkimDomain: "custmx.one.example",
		summary: "Signed by custmx.one.example instead.",
	},
	category: { value: "personal" },
	flags: { vip: true },
	similar: [],
};

/** The rendered chip in the Category section. */
function categoryChip(data: IntelligenceData): string {
	const html = renderToString(createElement(IntelligencePanel, { data }));
	const marker = `>${data.category.value}</span>`;
	const end = html.indexOf(marker);
	assert.notEqual(end, -1, `expected a chip reading '${data.category.value}'`);
	const start = html.lastIndexOf("<span", end);
	return html.slice(start, end + marker.length);
}

describe("IntelligencePanel category chip", () => {
	it("takes its colour from the category, not the authenticity verdict", () => {
		const chip = categoryChip(vipWithFailingAuthenticity);
		assert.doesNotMatch(chip, /danger/);
		assert.match(chip, /text-accent-2/);
	});

	it("renders the same chip for a category whatever the verdict said", () => {
		const failing = categoryChip(vipWithFailingAuthenticity);
		const aligned = categoryChip({
			...vipWithFailingAuthenticity,
			authenticity: {
				verdict: "aligned",
				fromDomain: "sabrinabasten.example",
				summary: "Nothing looks unusual about this sender.",
			},
		});
		assert.equal(failing, aligned);
	});

	it("gives each category its own tone", () => {
		const receipt = categoryChip({
			...vipWithFailingAuthenticity,
			category: { value: "transactional" },
		});
		assert.match(receipt, /text-positive/);
		const newsletter = categoryChip({
			...vipWithFailingAuthenticity,
			category: { value: "newsletter" },
		});
		assert.match(newsletter, /text-fg-muted/);
	});
});
