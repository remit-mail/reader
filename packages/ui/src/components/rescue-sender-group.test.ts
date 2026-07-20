import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { RescueCandidate } from "./rescue-candidate-row.js";
import {
	groupRescueCandidatesBySender,
	senderGroupSelectionState,
} from "./rescue-sender-group.js";

const candidate = (
	id: string,
	senderAddress: string,
	senderName = senderAddress,
): RescueCandidate => ({
	id,
	senderName,
	senderAddress,
	subject: `subject ${id}`,
	snippet: "",
	trustReason: "We can verify this sender",
	trustSubReason: "You've emailed them before",
	senderTrust: "wellknown",
});

describe("groupRescueCandidatesBySender", () => {
	it("collapses a queue into one entry per sender", () => {
		const groups = groupRescueCandidatesBySender([
			candidate("a", "news@shop.com"),
			candidate("b", "mum@gmail.com"),
			candidate("c", "news@shop.com"),
			candidate("d", "news@shop.com"),
		]);

		assert.deepEqual(
			groups.map((g) => [g.senderAddress, g.messages.length]),
			[
				["news@shop.com", 3],
				["mum@gmail.com", 1],
			],
			"biggest sender first — that is where the review time goes",
		);
	});

	it("treats a sender as one sender regardless of address casing", () => {
		const groups = groupRescueCandidatesBySender([
			candidate("a", "News@Shop.com"),
			candidate("b", "news@shop.com"),
		]);
		assert.equal(groups.length, 1);
		assert.equal(groups[0].messages.length, 2);
	});

	it("keeps arrival order between senders with the same message count", () => {
		const groups = groupRescueCandidatesBySender([
			candidate("a", "first@x.com"),
			candidate("b", "second@x.com"),
		]);
		assert.deepEqual(
			groups.map((g) => g.senderAddress),
			["first@x.com", "second@x.com"],
		);
	});

	it("falls back to the sender name when there is no address", () => {
		const groups = groupRescueCandidatesBySender([
			candidate("a", "", "Unknown sender"),
			candidate("b", "", "Unknown sender"),
		]);
		assert.equal(groups.length, 1);
	});

	it("returns nothing for an empty queue", () => {
		assert.deepEqual(groupRescueCandidatesBySender([]), []);
	});
});

describe("senderGroupSelectionState", () => {
	const [group] = groupRescueCandidatesBySender([
		candidate("a", "news@shop.com"),
		candidate("b", "news@shop.com"),
	]);

	it("reports all, some and none so the group checkbox can be tri-state", () => {
		assert.equal(senderGroupSelectionState(group, new Set(["a", "b"])), "all");
		assert.equal(senderGroupSelectionState(group, new Set(["a"])), "some");
		assert.equal(senderGroupSelectionState(group, new Set()), "none");
	});

	it("ignores selections belonging to other senders", () => {
		assert.equal(senderGroupSelectionState(group, new Set(["zz"])), "none");
	});
});
