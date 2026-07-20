import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { SearchResult } from "@remit/ui";
import { spamOfferForResults } from "./spam-offer";

const row = (
	id: string,
	mailboxId: string,
	role?: "junk" | "inbox",
): SearchResult => ({
	id,
	sender: "Someone",
	subject: "Subject",
	snippet: "",
	date: "",
	mailboxId,
	...(role ? { folder: { role } } : {}),
});

describe("spamOfferForResults", () => {
	it("makes no offer when nothing came from Spam", () => {
		assert.equal(
			spamOfferForResults([row("1", "mb-inbox", "inbox"), row("2", "mb-a")]),
			undefined,
		);
	});

	it("counts the spam rows and names their mailbox", () => {
		assert.deepEqual(
			spamOfferForResults([
				row("1", "mb-inbox", "inbox"),
				row("2", "mb-junk", "junk"),
				row("3", "mb-junk", "junk"),
			]),
			{ mailboxId: "mb-junk", count: 2 },
		);
	});

	it("targets the Spam folder with the most matches when accounts compete", () => {
		assert.deepEqual(
			spamOfferForResults([
				row("1", "mb-junk-a", "junk"),
				row("2", "mb-junk-b", "junk"),
				row("3", "mb-junk-b", "junk"),
			]),
			{ mailboxId: "mb-junk-b", count: 2 },
		);
	});

	it("breaks a tie on result order, so the offer does not flip", () => {
		assert.deepEqual(
			spamOfferForResults([
				row("1", "mb-junk-a", "junk"),
				row("2", "mb-junk-b", "junk"),
			]),
			{ mailboxId: "mb-junk-a", count: 1 },
		);
	});

	it("picks a destination without claiming to have counted every account", () => {
		// Three spam rows across two accounts: the destination is the bigger folder,
		// and its share is 2 — deliberately not the total, which the results list
		// states for itself so the banner cannot under-report.
		const offer = spamOfferForResults([
			row("1", "mb-junk-a", "junk"),
			row("2", "mb-junk-b", "junk"),
			row("3", "mb-junk-b", "junk"),
		]);
		assert.equal(offer?.mailboxId, "mb-junk-b");
		assert.equal(offer?.count, 2);
	});

	it("ignores a spam row that carries no mailbox to navigate to", () => {
		const orphan: SearchResult = {
			id: "1",
			sender: "Someone",
			subject: "Subject",
			snippet: "",
			date: "",
			folder: { role: "junk" },
		};
		assert.equal(spamOfferForResults([orphan]), undefined);
	});
});
