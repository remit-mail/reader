/**
 * The two criteria the unified listing could not previously ask about: the body
 * text a message carries, and whether its sender is muted.
 *
 * Both were client passes over the rows a page had already fetched, so both
 * answered "among the mail loaded so far" while being presented as answers about
 * the collection. The fixture puts the row that matters below the newest page in
 * each case, which is exactly what such a pass cannot see (#1135, #1137).
 */
import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import type { CreateThreadMessageInput } from "@remit/data-ports";
import { addressTable } from "../schema/i4-address.js";
import { threadMessageTable } from "../schema/thread-message.js";
import { createSqliteTestDb } from "../test-db-sqlite.js";
import { DrizzleThreadMessageRepository } from "./thread-message.js";

const ACCOUNT = "acct-seam";
const MAILBOX = "mbx-seam";
const SCOPE = new Set([MAILBOX]);

const BASE_DATE = 1_700_000_000_000;

let sequence = 0;
const makeInput = (
	overrides: Partial<CreateThreadMessageInput> = {},
): CreateThreadMessageInput => {
	sequence += 1;
	return {
		accountConfigId: ACCOUNT,
		threadId: `t-${sequence}`,
		messageId: `m-${sequence}`,
		mailboxId: MAILBOX,
		uid: sequence,
		referenceOrder: 0,
		internalDate: BASE_DATE,
		sentDate: BASE_DATE,
		isRead: false,
		isDeleted: false,
		hasAttachment: false,
		hasStars: false,
		...overrides,
	};
};

describe("thread-message body and muted-sender predicates (sqlite)", () => {
	let db: Awaited<ReturnType<typeof createSqliteTestDb>>["db"];
	let close: () => Promise<void>;
	let repo: DrizzleThreadMessageRepository;

	before(async () => {
		({ db, close } = await createSqliteTestDb(
			{ threadMessage: threadMessageTable, address: addressTable },
			{ searchIndex: true },
		));
		repo = new DrizzleThreadMessageRepository(db);
	});

	after(async () => {
		await close();
	});

	describe("a body-only match", () => {
		before(async () => {
			// Newer noise, so the matching row is not on the newest page.
			for (let index = 0; index < 20; index += 1) {
				await repo.create(
					makeInput({
						subject: "unrelated note",
						fromEmail: "noise@example.com",
						fromName: "Noise",
						snippet: "nothing to see",
						sentDate: BASE_DATE + 1000 + index,
					}),
				);
			}
			await repo.create(
				makeInput({
					subject: "unrelated note",
					fromEmail: "noise@example.com",
					fromName: "Noise",
					snippet: "Your parcel was left with the concierge",
					sentDate: BASE_DATE,
				}),
			);
		});

		test("the term reaches the body text, not just subject and From", async () => {
			const result = await repo.searchByDate(
				ACCOUNT,
				{ query: "concierge" },
				{ mailboxIds: SCOPE, limit: 50 },
			);

			assert.deepEqual(
				result.items.map((item) => item.snippet),
				["Your parcel was left with the concierge"],
			);
		});

		// The point of moving it into the query: a page smaller than the noise
		// still returns the match, where a pass over the loaded rows returns
		// nothing until the reader has scrolled past it.
		test("a match below the newest page is still returned", async () => {
			const result = await repo.searchByDate(
				ACCOUNT,
				{ query: "concierge" },
				{ mailboxIds: SCOPE, limit: 5 },
			);

			assert.equal(result.items.length, 1);
		});

		test("a term under the trigram floor reads the body too", async () => {
			const result = await repo.searchByDate(
				ACCOUNT,
				{ query: "ge" },
				{ mailboxIds: SCOPE, limit: 50 },
			);

			assert.ok(
				result.items.some((item) => item.snippet?.includes("concierge")),
				"the folded scan matched the body preview",
			);
		});

		test("every term must still match somewhere", async () => {
			const result = await repo.searchByDate(
				ACCOUNT,
				{ query: "concierge unrelated" },
				{ mailboxIds: SCOPE, limit: 50 },
			);
			assert.equal(result.items.length, 1);

			const none = await repo.searchByDate(
				ACCOUNT,
				{ query: "concierge zyxwvut" },
				{ mailboxIds: SCOPE, limit: 50 },
			);
			assert.equal(none.items.length, 0);
		});
	});

	describe("the muted-sender term", () => {
		const MUTED_ACCOUNT = "acct-muted";
		const MUTED_MAILBOX = "mbx-muted";
		const MUTED_SCOPE = new Set([MUTED_MAILBOX]);

		before(async () => {
			await db.insert(addressTable).values([
				{
					addressId: "addr-muted",
					accountConfigId: MUTED_ACCOUNT,
					displayName: "Loud Marketer",
					localPart: "loud",
					domain: "example.com",
					normalizedEmail: "loud@example.com",
					normalizedCompound: "loud marketer loud@example.com",
					flags: { muted: { value: true, setAt: 0 } } as never,
					inboundCount: 0,
					outboundCount: 0,
					replyCount: 0,
					lastInboundAt: 0,
					lastReplyAt: 0,
					createdAt: BASE_DATE,
					updatedAt: BASE_DATE,
				},
				{
					addressId: "addr-kept",
					accountConfigId: MUTED_ACCOUNT,
					displayName: "Colleague",
					localPart: "kept",
					domain: "example.com",
					normalizedEmail: "kept@example.com",
					normalizedCompound: "colleague kept@example.com",
					flags: { muted: { value: false, setAt: 0 } } as never,
					inboundCount: 0,
					outboundCount: 0,
					replyCount: 0,
					lastInboundAt: 0,
					lastReplyAt: 0,
					createdAt: BASE_DATE,
					updatedAt: BASE_DATE,
				},
			]);

			// Three from the kept sender on top, the muted sender's mail below
			// them: the arrangement the old client pass could not see.
			for (let index = 0; index < 3; index += 1) {
				await repo.create(
					makeInput({
						accountConfigId: MUTED_ACCOUNT,
						mailboxId: MUTED_MAILBOX,
						category: "marketing",
						fromEmail: "kept@example.com",
						fromName: "Colleague",
						subject: `kept ${index}`,
						sentDate: BASE_DATE + 1000 + index,
					}),
				);
			}
			for (let index = 0; index < 4; index += 1) {
				await repo.create(
					makeInput({
						accountConfigId: MUTED_ACCOUNT,
						mailboxId: MUTED_MAILBOX,
						category: "marketing",
						fromEmail: "loud@example.com",
						fromName: "Loud Marketer",
						subject: `muted ${index}`,
						sentDate: BASE_DATE + index,
					}),
				);
			}
			// No Address row at all: unknown is not muted.
			await repo.create(
				makeInput({
					accountConfigId: MUTED_ACCOUNT,
					mailboxId: MUTED_MAILBOX,
					category: "marketing",
					fromEmail: "stranger@example.com",
					fromName: "Stranger",
					subject: "stranger",
					sentDate: BASE_DATE - 1,
				}),
			);
		});

		test("muted=false drops the muted sender's mail from the listing", async () => {
			const page = await repo.listByDate(MUTED_ACCOUNT, {
				inboxMailboxIds: MUTED_SCOPE,
				search: { muted: false },
				limit: 50,
			});

			assert.deepEqual(page.items.map((item) => item.subject).sort(), [
				"kept 0",
				"kept 1",
				"kept 2",
				"stranger",
			]);
		});

		// The defect: the header counted the muted sender's mail while the list
		// dropped it, so "Show all" opened rows the brief would not render.
		test("the count answers the same predicate as the listing", async () => {
			const counted = await repo.countThreadsInScope(
				MUTED_ACCOUNT,
				{ muted: false },
				{ mailboxIds: MUTED_SCOPE },
			);
			const wider = await repo.countThreadsInScope(
				MUTED_ACCOUNT,
				{},
				{ mailboxIds: MUTED_SCOPE },
			);

			assert.equal(counted, 4);
			assert.equal(wider, 8);
		});

		test("muted=true asks for the muted sender's mail alone", async () => {
			const page = await repo.listByDate(MUTED_ACCOUNT, {
				inboxMailboxIds: MUTED_SCOPE,
				search: { muted: true },
				limit: 50,
			});

			assert.equal(page.items.length, 4);
			assert.ok(
				page.items.every((item) => item.fromEmail === "loud@example.com"),
				"only the muted sender",
			);
		});

		test("an unstated muted term filters nothing", async () => {
			const page = await repo.listByDate(MUTED_ACCOUNT, {
				inboxMailboxIds: MUTED_SCOPE,
				search: {},
				limit: 50,
			});

			assert.equal(page.items.length, 8);
		});

		test("mute composes with the other criteria", async () => {
			const counted = await repo.countThreadsInScope(
				MUTED_ACCOUNT,
				{ muted: false, category: ["marketing"] },
				{ mailboxIds: MUTED_SCOPE },
			);

			assert.equal(counted, 4);
		});
	});
});
