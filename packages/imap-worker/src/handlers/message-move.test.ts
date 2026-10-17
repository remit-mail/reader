import assert from "node:assert";
import { describe, it } from "node:test";
import type { ThreadMessageItem } from "@remit/data-ports";
import type { Logger } from "@remit/logger-lambda";
import type { IImapConnection } from "@remit/mailbox-service";
import {
	buildThreadMessageMoveUpdate,
	probePausedPlacement,
	searchMailboxForHighestMessageIdUid,
} from "./message-move.js";

const _silentLogger = (() => {
	const noop = () => {};
	const log = {
		info: noop,
		warn: noop,
		error: noop,
		debug: noop,
		fatal: noop,
		trace: noop,
		child: () => log,
	} as unknown as Logger;
	return log;
})();

const sourceMailboxId = "source-mailbox-id-aaaaaaaaa";
const destinationMailboxId = "destination-mailbox-aaaaa";

const baseThreadMessage = {
	sentDate: 1700000000000,
	mailboxId: sourceMailboxId,
	isRead: true,
	isDeleted: false,
	hasStars: true,
	hasAttachment: false,
} satisfies Pick<
	ThreadMessageItem,
	| "sentDate"
	| "mailboxId"
	| "isRead"
	| "isDeleted"
	| "hasStars"
	| "hasAttachment"
>;

describe("buildThreadMessageMoveUpdate", () => {
	// Regression for the same composites-direction landmine PR #186 fixed in
	// `flag-queue.ts`. The CURRENT row state must go in `composites`; the NEW
	// values must go in `set`. Flipping any of these silently drops the
	// ThreadMessage local update on every IMAP MOVE — the row stays in the
	// source mailbox while the IMAP server thinks it moved.

	it("set carries the NEW uid, mailboxId, and isDeleted=false", () => {
		const args = buildThreadMessageMoveUpdate(
			baseThreadMessage,
			42,
			destinationMailboxId,
		);

		assert.strictEqual(args.set.uid, 42, "set.uid must be the NEW uid");
		assert.strictEqual(
			args.set.mailboxId,
			destinationMailboxId,
			"set.mailboxId must be the NEW destination mailbox",
		);
		assert.strictEqual(
			args.set.isDeleted,
			false,
			"set.isDeleted must be false (move is not a delete)",
		);
	});

	it("composites mirrors every CURRENT indexed attribute on the threadMessage", () => {
		const tm = {
			sentDate: 1700000000123,
			mailboxId: sourceMailboxId,
			isRead: false,
			isDeleted: true,
			hasStars: true,
			hasAttachment: true,
		};

		const args = buildThreadMessageMoveUpdate(tm, 99, destinationMailboxId);

		assert.deepStrictEqual(args.composites, {
			sentDate: tm.sentDate,
			mailboxId: tm.mailboxId,
			isRead: tm.isRead,
			isDeleted: tm.isDeleted,
			hasStars: tm.hasStars,
			hasAttachment: tm.hasAttachment,
		});
	});
});

const _accountId = "alice-account-aaaaaaaaaa";

describe("probePausedPlacement — which folder a paused mutation left the message in (#1203)", () => {
	const buildConnection = (
		holdings: Record<string, number[]>,
	): { connection: IImapConnection; opened: string[] } => {
		const opened: string[] = [];
		let current = "";
		return {
			opened,
			connection: {
				openBox: async (path: string) => {
					opened.push(path);
					current = path;
					return {} as never;
				},
				search: async () => holdings[current] ?? [],
			} as unknown as IImapConnection,
		};
	};

	const probe = (holdings: Record<string, number[]>) => {
		const { connection, opened } = buildConnection(holdings);
		return {
			opened,
			result: probePausedPlacement(connection, {
				messageIdHeader: "<paused@example.com>",
				sourceMailboxPath: "INBOX",
				destinationMailboxPath: "Archive",
			}),
		};
	};

	it("stops at the source and never asks the destination when the source still holds it", async () => {
		const { opened, result } = probe({ INBOX: [4], Archive: [12] });

		assert.deepStrictEqual(await result, { kind: "at-source" });
		assert.deepStrictEqual(
			opened,
			["INBOX"],
			"a source hit ends it: with the mutation unrun, every destination hit is an older copy (#1122)",
		);
	});

	it("answers the destination's highest matching uid once the source has let go", async () => {
		const { result } = probe({ INBOX: [], Archive: [12, 77] });

		assert.deepStrictEqual(await result, { kind: "at-destination", uid: 77 });
	});

	it("answers gone when neither folder holds it", async () => {
		assert.deepStrictEqual(await probe({}).result, { kind: "gone" });
	});

	it("answers gone, not at-source, when there is no destination to ask", async () => {
		const { connection, opened } = buildConnection({ INBOX: [] });

		assert.deepStrictEqual(
			await probePausedPlacement(connection, {
				messageIdHeader: "<paused@example.com>",
				sourceMailboxPath: "INBOX",
				destinationMailboxPath: undefined,
			}),
			{ kind: "gone" },
		);
		assert.deepStrictEqual(opened, ["INBOX"]);
	});

	// A row with no Message-ID header cannot be asked about, and the server's
	// silence is not an answer. `unprobeable` keeps that distinct from `gone`.
	it("asks nothing at all when the row carries no Message-ID header", async () => {
		const { connection, opened } = buildConnection({ INBOX: [4] });

		assert.deepStrictEqual(
			await probePausedPlacement(connection, {
				messageIdHeader: undefined,
				sourceMailboxPath: "INBOX",
				destinationMailboxPath: "Archive",
			}),
			{ kind: "unprobeable" },
		);
		assert.deepStrictEqual(opened, []);
	});
});

describe("searchMailboxForHighestMessageIdUid — the probe that binds a move to a UID (#912)", () => {
	const isMessageIdCriterion = (
		criterion: unknown,
	): criterion is [string, string, string] =>
		Array.isArray(criterion) &&
		criterion.length === 3 &&
		typeof criterion[0] === "string" &&
		criterion[0].toUpperCase() === "HEADER" &&
		typeof criterion[1] === "string" &&
		criterion[1].toLowerCase() === "message-id" &&
		typeof criterion[2] === "string";

	const buildDestination = (
		messages: Array<{ uid: number; messageIdHeader: string }>,
	): IImapConnection => {
		const searchAll = () => messages.map((row) => row.uid);
		return {
			openBox: async () => ({}) as never,
			search: async (criteria: unknown[]) => {
				const criterion = criteria.find(isMessageIdCriterion);
				if (criterion === undefined) return searchAll();
				return messages
					.filter((row) => row.messageIdHeader === criterion[2])
					.map((row) => row.uid);
			},
		} as unknown as IImapConnection;
	};

	it("asks the folder by Message-ID rather than by an interpolated string", async () => {
		const sent: unknown[][] = [];
		const destination = {
			openBox: async () => ({}) as never,
			search: async (criteria: unknown[]) => {
				sent.push(criteria);
				return [];
			},
		} as unknown as IImapConnection;

		await searchMailboxForHighestMessageIdUid(
			destination,
			"Archive",
			'<a"b@example.com>\r\nUID 1',
		);

		assert.deepStrictEqual(sent, [
			[["HEADER", "Message-ID", '<a"b@example.com>\r\nUID 1']],
		]);
	});

	it("answers null, not another message's UID, when the folder holds no such message", async () => {
		const destination = buildDestination([
			{ uid: 11, messageIdHeader: "<stranger-a@example.com>" },
			{ uid: 12, messageIdHeader: "<stranger-b@example.com>" },
		]);

		assert.strictEqual(
			await searchMailboxForHighestMessageIdUid(
				destination,
				"Archive",
				"<moved@example.com>",
			),
			null,
		);
	});

	it("answers the UID of the message carrying that Message-ID", async () => {
		const destination = buildDestination([
			{ uid: 11, messageIdHeader: "<stranger-a@example.com>" },
			{ uid: 12, messageIdHeader: "<moved@example.com>" },
		]);

		assert.strictEqual(
			await searchMailboxForHighestMessageIdUid(
				destination,
				"Archive",
				"<moved@example.com>",
			),
			12,
		);
	});

	// RFC 3501 does not order a SEARCH response, so the fresh copy is the
	// highest uid returned rather than the last one returned.
	it("takes the highest match whatever order the server lists them in", async () => {
		const destination = buildDestination([
			{ uid: 40, messageIdHeader: "<moved@example.com>" },
			{ uid: 12, messageIdHeader: "<moved@example.com>" },
		]);

		assert.strictEqual(
			await searchMailboxForHighestMessageIdUid(
				destination,
				"Archive",
				"<moved@example.com>",
			),
			40,
		);
	});
});
