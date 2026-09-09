/**
 * The exact match count is opt-in because it is a second read over the whole
 * match set (#307). These pin who pays for it and what happens when the server
 * declines to answer.
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { EscalationSearchQuery } from "@/hooks/useEscalatedActions";
import {
	type ResultCountRequestInput,
	shouldRequestResultCount,
	toResultCount,
} from "./result-count.js";

const request = (input: Partial<ResultCountRequestInput>): boolean =>
	shouldRequestResultCount({
		hasSearchQuery: true,
		freeText: "",
		residualTokenCount: 0,
		...input,
	});

describe("shouldRequestResultCount", () => {
	test("browsing a mailbox asks for no count", () => {
		assert.equal(request({ hasSearchQuery: false }), false);
	});

	test("a free-text query is not counted while it is being typed", () => {
		for (const freeText of ["k", "ku", " ku "]) {
			assert.equal(
				request({ freeText }),
				false,
				`"${freeText}" was counted per keystroke`,
			);
		}
	});

	test("a free-text query long enough for the index is counted", () => {
		assert.equal(request({ freeText: "kub" }), true);
	});

	test("a query made only of filter tokens is counted straight away", () => {
		assert.equal(request({}), true);
	});

	/**
	 * `before:`/`after:`/`account:` reach the request as nothing, so the server
	 * would count a wider set than the list shows — and `invoice before:2020`
	 * sends criteria identical to `invoice`, which is also the previous search's
	 * cache key.
	 */
	test("a term the request could not carry stops the count", () => {
		assert.equal(
			request({ freeText: "invoice", residualTokenCount: 1 }),
			false,
			"the count covered rows the list filters back out",
		);
		assert.equal(
			request({ freeText: "invoice", residualTokenCount: 0 }),
			true,
			"the same search without the residual term must still be counted",
		);
	});
});

describe("toResultCount", () => {
	test("the server's number is the whole match set", () => {
		assert.deepEqual(toResultCount(1284), { kind: "exact", value: 1284 });
	});

	test("zero matches is a number, not an absent count", () => {
		assert.deepEqual(toResultCount(0), { kind: "exact", value: 0 });
	});

	test("an absent count stays absent rather than becoming zero", () => {
		assert.deepEqual(toResultCount(undefined), { kind: "unknown" });
	});
});

/**
 * `searchThreads` withholds the count when the criteria carry an off-row term
 * (#305), and the escalated selection reads `count` as a required number to size
 * its run. Neither term can reach that predicate today; this fails the day one
 * is added, so the absent-count state gets designed rather than surfacing as a
 * run that refuses to start.
 */
describe("the escalation predicate carries no off-row criterion", () => {
	test("senderTrust and dkimMismatch are not part of it", () => {
		type OffRow = Extract<
			keyof EscalationSearchQuery,
			"senderTrust" | "dkimMismatch"
		>;
		const offRow: [OffRow] extends [never] ? true : false = true;
		assert.equal(offRow, true);
	});
});
