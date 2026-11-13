import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import type { CreateThreadMessageInput } from "@remit/data-ports";
import { NODE_SQLITE_LIMITS } from "../bound-parameters.js";
import { addressTable } from "../schema/i4-address.js";
import {
	messageSearchTextTable,
	messageTable,
} from "../schema/message-data.js";
import { threadMessageTable } from "../schema/thread-message.js";
import { createSqliteRepositories } from "../sqlite-repositories.js";
import { createSqliteTestDb } from "../test-db-sqlite.js";
import { sharedDatabases } from "../test-sqlite.js";
import { messageObjectsInMemory } from "./message-objects.js";
import type { DrizzleThreadMessageRepository } from "./thread-message.js";

const ACCOUNT = "acct-junk";
const JUNK = "mbx-junk";
const BASE_DATE = 1_700_000_000_000;
const LIMIT = 10;
const UNTRUSTED = LIMIT * 3;

const RESCUE = {
	senderTrust: ["vip" as const, "wellknown" as const],
	dkimMismatch: false,
};

describe("thread-message search by sender trust and DKIM (sqlite)", () => {
	let db: Awaited<ReturnType<typeof createSqliteTestDb>>["db"];
	let close: () => Promise<void>;
	let repo: DrizzleThreadMessageRepository;
	let sequence = 0;

	const seed = async (
		fromEmail: string,
		sentDate: number,
		authenticity: { dkimMismatch: boolean } | null,
	): Promise<CreateThreadMessageInput> => {
		sequence += 1;
		const input: CreateThreadMessageInput = {
			accountConfigId: ACCOUNT,
			threadId: `t-${sequence}`,
			messageId: `m-${sequence}`,
			mailboxId: JUNK,
			uid: sequence,
			referenceOrder: 0,
			internalDate: sentDate,
			sentDate,
			isRead: false,
			isDeleted: false,
			hasAttachment: false,
			hasStars: false,
			fromEmail,
			subject: `${fromEmail} ${sequence}`,
		};
		await db.insert(messageTable).values({
			messageId: input.messageId,
			mailboxId: JUNK,
			uid: sequence,
			sequenceNumber: sequence,
			rfc822Size: 1,
			internalDate: sentDate,
			envelopeId: `e-${sequence}`,
			rootBodyPartId: `b-${sequence}`,
			authenticity: authenticity as never,
			createdAt: BASE_DATE,
			updatedAt: BASE_DATE,
		});
		await repo.create(input);
		return input;
	};

	const address = (email: string, flags: Record<string, unknown>) => ({
		addressId: `addr-${email}`,
		accountConfigId: ACCOUNT,
		displayName: email,
		localPart: email.split("@")[0],
		domain: "example.com",
		normalizedEmail: email,
		normalizedCompound: email,
		flags: flags as never,
		inboundCount: 0,
		outboundCount: 0,
		replyCount: 0,
		lastInboundAt: 0,
		lastReplyAt: 0,
		createdAt: BASE_DATE,
		updatedAt: BASE_DATE,
	});

	const trusted: string[] = [];

	before(async () => {
		({ db, close } = await createSqliteTestDb(
			{
				threadMessage: threadMessageTable,
				address: addressTable,
				message: messageTable,
				messageSearchText: messageSearchTextTable,
			},
			{ searchIndex: true },
		));
		repo = createSqliteRepositories(
			sharedDatabases(db),
			NODE_SQLITE_LIMITS,
			messageObjectsInMemory(),
		).threadMessage;

		await db.insert(addressTable).values([
			address("vip@example.com", { vip: { value: true, setAt: 0 } }),
			address("known@example.com", {
				wellknown: { value: true, setAt: 0 },
			}),
			address("spam@example.com", {}),
		]);

		for (let index = 0; index < UNTRUSTED; index += 1) {
			await seed("spam@example.com", BASE_DATE + 1000 + index, {
				dkimMismatch: false,
			});
		}
		for (const [fromEmail, offset] of [
			["vip@example.com", 3],
			["known@example.com", 2],
			["Vip@Example.com", 1],
		] as const) {
			const input = await seed(fromEmail, BASE_DATE + offset, {
				dkimMismatch: false,
			});
			trusted.push(input.messageId);
		}
		await seed("stranger@example.com", BASE_DATE + 900, {
			dkimMismatch: false,
		});
		await seed("vip@example.com", BASE_DATE + 901, { dkimMismatch: true });
		await seed("vip@example.com", BASE_DATE + 902, null);
	});

	after(async () => {
		await close();
	});

	test("trusted rows below a page of untrusted ones all come back in one page", async () => {
		const page = await repo.searchByMailboxWindow(ACCOUNT, JUNK, RESCUE, {
			excludeDeleted: true,
			limit: LIMIT,
		});

		assert.deepEqual(
			page.items.map((item) => item.messageId),
			trusted,
		);
		assert.equal(page.continuationToken, undefined);
	});

	test("the cursor pages through the matching rows only", async () => {
		const first = await repo.searchByMailboxWindow(ACCOUNT, JUNK, RESCUE, {
			excludeDeleted: true,
			limit: 2,
		});
		const second = await repo.searchByMailboxWindow(ACCOUNT, JUNK, RESCUE, {
			excludeDeleted: true,
			limit: 2,
			continuationToken: first.continuationToken,
		});

		assert.deepEqual(
			[...first.items, ...second.items].map((item) => item.messageId),
			trusted,
		);
		assert.equal(second.continuationToken, undefined);
	});

	test("unknown matches a sender with no address row or no trust flag", async () => {
		const page = await repo.searchByMailboxWindow(
			ACCOUNT,
			JUNK,
			{ senderTrust: ["unknown"] },
			{ excludeDeleted: true, limit: 500 },
		);

		assert.equal(page.items.length, UNTRUSTED + 1);
		assert.ok(
			page.items.every(
				(item) =>
					item.fromEmail === "spam@example.com" ||
					item.fromEmail === "stranger@example.com",
			),
		);
	});
});
