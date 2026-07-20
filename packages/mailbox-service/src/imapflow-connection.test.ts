import assert from "node:assert";
import { describe, it } from "node:test";
import {
	ImapFlowConnection,
	toInternalDate,
	toIsoDateString,
} from "./imapflow-connection.js";
import type { ImapMessage } from "./types.js";

describe("toIsoDateString", () => {
	it("converts a Date to an ISO string", () => {
		const date = new Date("2026-06-21T10:20:30.000Z");
		assert.strictEqual(toIsoDateString(date), "2026-06-21T10:20:30.000Z");
	});

	it("converts a date string to an ISO string", () => {
		assert.strictEqual(
			toIsoDateString("2026-06-21T10:20:30.000Z"),
			"2026-06-21T10:20:30.000Z",
		);
	});

	it("converts an epoch number to an ISO string", () => {
		assert.strictEqual(toIsoDateString(0), new Date(0).toISOString());
	});

	it('returns "" for an invalid date string', () => {
		assert.strictEqual(toIsoDateString("not a date"), "");
	});

	it('returns "" for an invalid Date', () => {
		assert.strictEqual(toIsoDateString(new Date("not a date")), "");
	});

	it('returns "" for undefined', () => {
		assert.strictEqual(toIsoDateString(undefined), "");
	});

	it('returns "" for null', () => {
		assert.strictEqual(toIsoDateString(null), "");
	});

	it('returns "" for a non-Date value without toISOString instead of throwing', () => {
		assert.strictEqual(toIsoDateString({ foo: "bar" }), "");
	});
});

describe("toInternalDate", () => {
	it("passes through a valid Date", () => {
		const date = new Date("2026-06-21T10:20:30.000Z");
		assert.strictEqual(toInternalDate(date), date);
	});

	it("parses a valid date string", () => {
		const result = toInternalDate("2026-06-21T10:20:30.000Z");
		assert.ok(result instanceof Date);
		assert.strictEqual(result?.toISOString(), "2026-06-21T10:20:30.000Z");
	});

	it("parses a numeric epoch", () => {
		const result = toInternalDate(0);
		assert.strictEqual(result?.getTime(), 0);
	});

	it("returns null for an absent value (transient imapflow row, #408)", () => {
		assert.strictEqual(toInternalDate(null), null);
		assert.strictEqual(toInternalDate(undefined), null);
	});

	it("falls back to a valid now for an unparseable string, never NaN", () => {
		const result = toInternalDate("not a date");
		assert.ok(result instanceof Date);
		assert.ok(Number.isFinite(result?.getTime()));
	});

	it("falls back to a valid now for an Invalid Date object", () => {
		const result = toInternalDate(new Date("nonsense"));
		assert.ok(result instanceof Date);
		assert.ok(Number.isFinite(result?.getTime()));
	});

	it("falls back to a valid now for an unexpected type instead of throwing", () => {
		const result = toInternalDate({ foo: "bar" });
		assert.ok(result instanceof Date);
		assert.ok(Number.isFinite(result?.getTime()));
	});
});

const buildConnectionWithClient = (client: unknown): ImapFlowConnection => {
	const connection = new ImapFlowConnection({
		host: "localhost",
		port: 143,
		user: "alice@example.com",
		credentials: { kind: "password", password: "x" },
		tls: false,
	});
	Object.assign(connection as unknown as Record<string, unknown>, {
		client,
		_state: "authenticated",
	});
	return connection;
};

const fakeMailbox = (path: string, exists: number) => ({
	path,
	delimiter: "/",
	flags: new Set<string>(),
	permanentFlags: new Set<string>(),
	uidValidity: 1n,
	uidNext: exists + 1,
	exists,
	readOnly: true,
});

describe("ImapFlowConnection.search — the probe every stale-row reconcile rests on (#102)", () => {
	const buildSearchConnection = (
		result: unknown,
		calls: Array<{ query: unknown; options: unknown }> = [],
	): ImapFlowConnection => {
		const connection = buildConnectionWithClient({
			mailboxOpen: async (path: string) => fakeMailbox(path, 1),
			search: async (query: unknown, options: unknown) => {
				calls.push({ query, options });
				return result;
			},
		});
		return connection;
	};

	it("translates a UID criterion into a UID SEARCH answering UIDs, not sequence numbers", async () => {
		const calls: Array<{ query: unknown; options: unknown }> = [];
		const connection = buildSearchConnection([42], calls);
		await connection.openBox("INBOX", true);

		const result = await connection.search([["UID", "42"]]);

		assert.deepStrictEqual(result, [42]);
		assert.deepStrictEqual(calls, [
			{ query: { uid: "42" }, options: { uid: true } },
		]);
	});

	it("answers an empty array when the server matched nothing", async () => {
		const connection = buildSearchConnection([]);
		await connection.openBox("INBOX", true);

		assert.deepStrictEqual(await connection.search([["UID", "42"]]), []);
	});

	it("throws on a failed SEARCH instead of reporting it as no matches", async () => {
		const connection = buildSearchConnection(false);
		await connection.openBox("INBOX", true);

		await assert.rejects(
			() => connection.search([["UID", "42"]]),
			/SEARCH failed/,
		);
	});
});

describe("ImapFlowConnection.getMailboxStatus — deletedCount (#1042)", () => {
	it("returns the SEARCH \\Deleted count alongside the STATUS counts", async () => {
		const searchQueries: Array<Record<string, unknown>> = [];
		const connection = buildConnectionWithClient({
			status: async () => ({
				path: "INBOX",
				messages: 10,
				recent: 0,
				unseen: 3,
				uidNext: 11,
				uidValidity: 1n,
				highestModseq: 0n,
			}),
			mailboxOpen: async (path: string) => fakeMailbox(path, 10),
			search: async (query: Record<string, unknown>) => {
				searchQueries.push(query);
				return query.deleted ? [1, 2] : [];
			},
		});

		const status = await connection.getMailboxStatus("INBOX");

		assert.strictEqual(status.messages, 10);
		assert.strictEqual(status.unseen, 3);
		assert.strictEqual(status.deletedCount, 2);
		assert.deepStrictEqual(searchQueries, [{ deleted: true }]);
	});

	it("reports zero deleted when SEARCH \\Deleted has no matches", async () => {
		const connection = buildConnectionWithClient({
			status: async () => ({
				path: "INBOX",
				messages: 4,
				recent: 0,
				unseen: 0,
				uidNext: 5,
				uidValidity: 1n,
				highestModseq: 0n,
			}),
			mailboxOpen: async (path: string) => fakeMailbox(path, 4),
			search: async () => [],
		});

		const status = await connection.getMailboxStatus("INBOX");

		assert.strictEqual(status.deletedCount, 0);
	});

	it("carries highestModseq above 2^53 as a lossless decimal string (reader#9)", async () => {
		const modseq = 18446744073709551615n;
		const connection = buildConnectionWithClient({
			status: async () => ({
				path: "INBOX",
				messages: 1,
				recent: 0,
				unseen: 0,
				uidNext: 2,
				uidValidity: 1n,
				highestModseq: modseq,
			}),
			mailboxOpen: async (path: string) => fakeMailbox(path, 1),
			search: async () => [],
		});

		const status = await connection.getMailboxStatus("INBOX");

		assert.strictEqual(status.highestModseq, "18446744073709551615");
		assert.strictEqual(BigInt(status.highestModseq), modseq);
	});
});

describe("ImapFlowConnection CONDSTORE (reader#20)", () => {
	const buildCondstoreConnection = (options: {
		enabled: Set<string>;
		noModseq?: boolean;
		fetched?: Array<Record<string, unknown>>;
		record?: Array<{ range: string; options: Record<string, unknown> }>;
	}): ImapFlowConnection => {
		const connection = buildConnectionWithClient({
			enabled: options.enabled,
			mailbox: { ...fakeMailbox("INBOX", 1), noModseq: options.noModseq },
			mailboxOpen: async (path: string) => fakeMailbox(path, 1),
			fetch: (
				range: string,
				_query: Record<string, unknown>,
				fetchOptions: Record<string, unknown>,
			) => {
				options.record?.push({ range, options: fetchOptions });
				return (async function* () {
					for (const row of options.fetched ?? []) yield row;
				})();
			},
		});
		Object.assign(connection as unknown as Record<string, unknown>, {
			currentMailbox: "INBOX",
		});
		return connection;
	};

	it("reports CONDSTORE only when the session enabled it and the mailbox keeps mod-sequences", () => {
		assert.strictEqual(
			buildCondstoreConnection({
				enabled: new Set(["CONDSTORE"]),
			}).supportsCondstore(),
			true,
		);
		assert.strictEqual(
			buildCondstoreConnection({ enabled: new Set() }).supportsCondstore(),
			false,
		);
		assert.strictEqual(
			buildCondstoreConnection({
				enabled: new Set(["CONDSTORE"]),
				noModseq: true,
			}).supportsCondstore(),
			false,
		);
	});

	it("refuses CHANGEDSINCE without CONDSTORE rather than fetching the whole mailbox", async () => {
		const connection = buildCondstoreConnection({ enabled: new Set() });

		await assert.rejects(
			() => connection.fetchMessagesChangedSince(500n),
			/CONDSTORE/,
		);
	});

	it("passes the mod-sequence through as a BigInt over the whole UID space", async () => {
		const record: Array<{ range: string; options: Record<string, unknown> }> =
			[];
		const connection = buildCondstoreConnection({
			enabled: new Set(["CONDSTORE"]),
			record,
			fetched: [
				{
					uid: 7,
					seq: 7,
					flags: new Set(["\\Seen"]),
					internalDate: new Date(0),
					size: 10,
					modseq: 18446744073709551615n,
				},
			],
		});

		const messages = await connection.fetchMessagesChangedSince(500n);

		assert.deepStrictEqual(record, [
			{ range: "1:*", options: { uid: true, changedSince: 500n } },
		]);
		assert.strictEqual(messages[0].modseq, "18446744073709551615");
		assert.deepStrictEqual(messages[0].flags, ["\\Seen"]);
	});
});

describe("ImapFlowConnection message envelopes (issue #72)", () => {
	const fetchRows = async (
		rows: Array<Record<string, unknown>>,
	): Promise<ImapMessage[]> => {
		const connection = buildConnectionWithClient({
			enabled: new Set(),
			mailbox: fakeMailbox("INBOX", 1),
			mailboxOpen: async (path: string) => fakeMailbox(path, 1),
			fetch: () =>
				(async function* () {
					for (const row of rows) yield row;
				})(),
		});
		Object.assign(connection as unknown as Record<string, unknown>, {
			currentMailbox: "INBOX",
		});
		return connection.fetchMessages([1]);
	};

	it("leaves an absent ENVELOPE absent instead of synthesising an empty one", async () => {
		// A synthesised envelope made every `if (!msg.envelope)` guard downstream
		// unreachable, so the row was saved as a message with no sender, subject
		// or date under a `generated:` key — indistinguishable from real mail.
		const [message] = await fetchRows([
			{ uid: 1, seq: 1, internalDate: new Date(0), size: 10 },
		]);
		assert.equal(message?.envelope, undefined);
	});

	it("still converts an envelope the server did send", async () => {
		const [message] = await fetchRows([
			{
				uid: 1,
				seq: 1,
				internalDate: new Date(0),
				size: 10,
				envelope: {
					subject: "Hello",
					messageId: "<a@example.com>",
					from: [{ address: "sender@example.com" }],
				},
			},
		]);
		assert.equal(message?.envelope?.subject, "Hello");
		assert.equal(message?.envelope?.from[0]?.mailbox, "sender");
	});
});
