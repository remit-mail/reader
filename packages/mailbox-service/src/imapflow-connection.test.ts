import assert from "node:assert";
import { describe, it } from "node:test";
import { ImapFlowConnection, toIsoDateString } from "./imapflow-connection.js";

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
			search: async () => false,
		});

		const status = await connection.getMailboxStatus("INBOX");

		assert.strictEqual(status.deletedCount, 0);
	});
});
