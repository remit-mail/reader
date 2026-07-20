import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isMessageGoneFromOpenMailbox } from "./message-presence.js";
import type { IImapConnection } from "./types.js";

type Probe = Pick<IImapConnection, "fetchMessages" | "search">;

const buildProbe = (
	fetched: number[],
	searched: number[],
	searchCalls: unknown[][] = [],
): Probe => ({
	fetchMessages: async () => fetched.map((uid) => ({ uid }) as never),
	search: async (criteria: unknown[]) => {
		searchCalls.push(criteria);
		return searched;
	},
});

describe("isMessageGoneFromOpenMailbox", () => {
	it("a FETCH row is proof of presence — no SEARCH needed", async () => {
		const searchCalls: unknown[][] = [];
		const gone = await isMessageGoneFromOpenMailbox(
			buildProbe([7], [], searchCalls),
			7,
		);

		assert.equal(gone, false);
		assert.equal(searchCalls.length, 0);
	});

	it("an empty FETCH the SEARCH contradicts is a dropped row, not an absence", async () => {
		const gone = await isMessageGoneFromOpenMailbox(buildProbe([], [7]), 7);

		assert.equal(gone, false);
	});

	it("only a SEARCH that does not list the uid confirms it is gone", async () => {
		const gone = await isMessageGoneFromOpenMailbox(buildProbe([], []), 7);

		assert.equal(gone, true);
	});

	it("asks the server for the uid it is about to reconcile", async () => {
		const searchCalls: unknown[][] = [];
		await isMessageGoneFromOpenMailbox(buildProbe([], [], searchCalls), 42);

		assert.deepEqual(searchCalls, [[["UID", "42"]]]);
	});
});
