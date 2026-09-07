import assert from "node:assert";
import { after, before, describe, test } from "node:test";
import { MailboxSyncStatus } from "@remit/domain-enums";
import { eq } from "drizzle-orm";
import {
	envelopeId as deriveEnvelopeId,
	rootBodyPartId as deriveRootBodyPartId,
} from "../id.js";
import {
	filterTable,
	mailboxSpecialUseTable,
	mailboxTable,
	messageTable,
	outboxTable,
	threadMessageTable,
} from "../schema.js";
import { createTestDb, randomId, type TestDb } from "../test-db.js";
import { runInTransaction } from "../tx.js";
import { MailboxRepo } from "./i4-mailbox.js";
import { DrizzleMessageRepository, deleteMessageSubtree } from "./message.js";

/** Every state a row can carry, for a transition that decides against none. */
const EVERY_STATE = [
	MailboxSyncStatus.synced,
	MailboxSyncStatus.pending,
	MailboxSyncStatus.failed,
	MailboxSyncStatus.deleting,
] as const;

function makeMailboxInput(accountId: string, fullPath = "INBOX") {
	return {
		accountId,
		namespaceType: "personal" as const,
		namespacePrefix: "",
		hierarchyDelimiter: "/",
		fullPath,
		uidValidity: 1,
		uidNext: 1,
		highestModseq: "0",
		messageCount: 0,
		unseenCount: 5,
		deletedCount: 0,
		totalSize: 0,
		lastSyncUid: 0,
		highWaterMarkUid: 0,
		lastMessageSyncAt: Date.now(),
	};
}

describe("MailboxRepo", () => {
	let db: TestDb;
	let close: () => Promise<void>;
	let repo: MailboxRepo;

	before(async () => {
		({ db, close } = await createTestDb());
		repo = new MailboxRepo(db as never);
	});

	after(async () => {
		await close();
	});

	test("create and get", async () => {
		const accountId = randomId();
		const mailbox = await repo.create(makeMailboxInput(accountId));
		assert.ok(mailbox.mailboxId);
		assert.equal(mailbox.fullPath, "INBOX");

		const fetched = await repo.get(accountId, mailbox.mailboxId);
		assert.equal(fetched.mailboxId, mailbox.mailboxId);

		await repo.delete(accountId, mailbox.mailboxId);
	});

	test("highestModseq round-trips a value above 2^53 without loss (reader#9)", async () => {
		const accountId = randomId();
		const modseq = "18446744073709551615";
		const created = await repo.create({
			...makeMailboxInput(accountId),
			highestModseq: modseq,
		});
		assert.equal(created.highestModseq, modseq);

		const fetched = await repo.get(accountId, created.mailboxId);
		assert.equal(fetched.highestModseq, modseq);
		assert.equal(BigInt(fetched.highestModseq) > 2n ** 53n, true);

		const updated = await repo.update(accountId, created.mailboxId, {
			highestModseq: "9007199254740993",
		});
		assert.equal(updated.highestModseq, "9007199254740993");
		const reread = await repo.get(accountId, created.mailboxId);
		assert.equal(reread.highestModseq, "9007199254740993");

		await repo.delete(accountId, created.mailboxId);
	});

	test("batchGet: WHERE id = ANY($1)", async () => {
		const accountId = randomId();
		const m1 = await repo.create(makeMailboxInput(accountId, "INBOX"));
		const m2 = await repo.create(makeMailboxInput(accountId, "Sent"));

		const results = await repo.get(accountId, [m1.mailboxId, m2.mailboxId]);
		assert.equal(results.length, 2);

		await repo.deleteMany(accountId, [m1.mailboxId, m2.mailboxId]);
	});

	test("batchGet empty array returns []", async () => {
		const results = await repo.get(randomId(), []);
		assert.deepEqual(results, []);
	});

	test("findByPath finds existing mailbox", async () => {
		const accountId = randomId();
		await repo.create(makeMailboxInput(accountId, "Work/Projects"));

		const found = await repo.findByPath(accountId, "Work/Projects");
		assert.ok(found);
		assert.equal(found.fullPath, "Work/Projects");
	});

	test("findByPath returns null when not found", async () => {
		const result = await repo.findByPath(randomId(), "INBOX");
		assert.equal(result, null);
	});

	test("getOrCreateByPath creates when missing", async () => {
		const accountId = randomId();
		const mailbox = await repo.getOrCreateByPath(
			accountId,
			"Drafts",
			makeMailboxInput(accountId, "Drafts"),
		);
		assert.equal(mailbox.fullPath, "Drafts");

		const again = await repo.getOrCreateByPath(
			accountId,
			"Drafts",
			makeMailboxInput(accountId, "Drafts"),
		);
		assert.equal(again.mailboxId, mailbox.mailboxId, "idempotent");
	});

	test("findByPathPrefix finds children", async () => {
		const accountId = randomId();
		await repo.create(makeMailboxInput(accountId, "Work"));
		await repo.create(makeMailboxInput(accountId, "Work/Projects"));
		await repo.create(makeMailboxInput(accountId, "Work/Projects/Alpha"));

		const children = await repo.findByPathPrefix(accountId, "Work");
		assert.ok(children.some((m) => m.fullPath === "Work/Projects"));
		assert.ok(children.some((m) => m.fullPath === "Work/Projects/Alpha"));
		assert.equal(
			children.find((m) => m.fullPath === "Work"),
			undefined,
			"prefix itself not included",
		);
	});

	test("findByPathPrefix finds nothing in a flat namespace", async () => {
		const accountId = randomId();
		await repo.create(makeMailboxInput(accountId, "Work"));
		await repo.create(makeMailboxInput(accountId, "Workshop"));

		assert.deepEqual(await repo.findByPathPrefix(accountId, "Work", ""), []);
	});

	test("cross-tenant: get refuses a foreign account", async () => {
		const accountId = randomId();
		const other = randomId();
		const mailbox = await repo.create(makeMailboxInput(accountId));

		await assert.rejects(
			() => repo.get(other, mailbox.mailboxId),
			/Mailbox not found/,
		);
		assert.deepEqual(await repo.get(other, [mailbox.mailboxId]), []);
		const owned = await repo.get(accountId, [mailbox.mailboxId]);
		assert.equal(owned.length, 1);

		await repo.delete(accountId, mailbox.mailboxId);
	});

	test("cross-tenant: update refuses a foreign account and leaves the row unchanged", async () => {
		const accountId = randomId();
		const other = randomId();
		const mailbox = await repo.create(makeMailboxInput(accountId));

		await assert.rejects(
			() => repo.update(other, mailbox.mailboxId, { messageCount: 99 }),
			/Mailbox not found/,
		);
		const still = await repo.get(accountId, mailbox.mailboxId);
		assert.equal(still.messageCount, 0);

		await repo.delete(accountId, mailbox.mailboxId);
	});

	test("cross-tenant: delete is a no-op for a foreign account", async () => {
		const accountId = randomId();
		const other = randomId();
		const mailbox = await repo.create(makeMailboxInput(accountId));

		await repo.delete(other, mailbox.mailboxId);
		const still = await repo.get(accountId, mailbox.mailboxId);
		assert.equal(still.mailboxId, mailbox.mailboxId);

		await repo.delete(accountId, mailbox.mailboxId);
	});

	test("cross-tenant: deleteMany only removes ids owned by the tenant", async () => {
		const accountA = randomId();
		const accountB = randomId();
		const a = await repo.create(makeMailboxInput(accountA));
		const b = await repo.create(makeMailboxInput(accountB));

		await repo.deleteMany(accountA, [a.mailboxId, b.mailboxId]);

		await assert.rejects(
			() => repo.get(accountA, a.mailboxId),
			/Mailbox not found/,
		);
		const survived = await repo.get(accountB, b.mailboxId);
		assert.equal(survived.mailboxId, b.mailboxId);

		await repo.delete(accountB, b.mailboxId);
	});

	describe("transition — the conditional write (D3)", () => {
		test("an accepted from-state applies the new state and the set fields", async () => {
			const accountId = randomId();
			const mailbox = await repo.create(makeMailboxInput(accountId, "Archive"));

			const written = await repo.transition(accountId, mailbox.mailboxId, {
				from: [MailboxSyncStatus.synced, MailboxSyncStatus.failed],
				to: MailboxSyncStatus.pending,
				set: { pendingPath: "Records" },
			});

			assert.equal(written?.syncStatus, MailboxSyncStatus.pending);
			assert.equal(written?.pendingPath, "Records");
			assert.equal(written?.fullPath, "Archive", "fullPath stays confirmed");
		});

		test("a state outside `from` writes nothing and leaves the row byte-identical", async () => {
			const accountId = randomId();
			const mailbox = await repo.create(makeMailboxInput(accountId, "Work"));
			const before = await repo.get(accountId, mailbox.mailboxId);

			const lost = await repo.transition(accountId, mailbox.mailboxId, {
				from: [MailboxSyncStatus.deleting],
				to: MailboxSyncStatus.synced,
				set: { fullPath: "Nope" },
			});

			assert.equal(lost, null);
			assert.deepEqual(await repo.get(accountId, mailbox.mailboxId), before);
		});

		test("an absent id is a null, not a throw", async () => {
			assert.equal(
				await repo.transition(randomId(), "no-such-mailbox", {
					from: EVERY_STATE,
					to: MailboxSyncStatus.synced,
				}),
				null,
			);
		});

		test("wherePendingPath as a string matches only that target", async () => {
			const accountId = randomId();
			const mailbox = await repo.create(makeMailboxInput(accountId, "Bills"));
			await repo.transition(accountId, mailbox.mailboxId, {
				from: [MailboxSyncStatus.synced],
				to: MailboxSyncStatus.pending,
				set: { pendingPath: "Invoices" },
			});

			assert.equal(
				await repo.transition(accountId, mailbox.mailboxId, {
					from: [MailboxSyncStatus.pending],
					wherePendingPath: "Somewhere else",
					to: MailboxSyncStatus.synced,
				}),
				null,
			);

			const settled = await repo.transition(accountId, mailbox.mailboxId, {
				from: [MailboxSyncStatus.pending],
				wherePendingPath: "Invoices",
				to: MailboxSyncStatus.synced,
				set: { fullPath: "Invoices", pendingPath: null },
			});
			assert.equal(settled?.fullPath, "Invoices");
		});

		test("wherePendingPath: null refuses a row a rename has claimed", async () => {
			// The seventh-state hole (D3): a create settle that predicates on
			// `pending` alone matches a row a rename has since claimed, writes
			// `synced` with the rename target still on it, and the rename then
			// never runs and is never marked failed.
			const accountId = randomId();
			const claimed = await repo.create(makeMailboxInput(accountId, "Notes"));
			await repo.transition(accountId, claimed.mailboxId, {
				from: [MailboxSyncStatus.synced],
				to: MailboxSyncStatus.pending,
				set: { pendingPath: "Journal" },
			});

			const createSettle = await repo.transition(accountId, claimed.mailboxId, {
				from: [MailboxSyncStatus.pending],
				wherePendingPath: null,
				to: MailboxSyncStatus.synced,
			});
			assert.equal(createSettle, null);

			const still = await repo.get(accountId, claimed.mailboxId);
			assert.equal(still.syncStatus, MailboxSyncStatus.pending);
			assert.equal(still.pendingPath, "Journal");

			const creating = await repo.create({
				...makeMailboxInput(accountId, "Fresh"),
				syncStatus: MailboxSyncStatus.pending,
			});
			const settled = await repo.transition(accountId, creating.mailboxId, {
				from: [MailboxSyncStatus.pending],
				wherePendingPath: null,
				to: MailboxSyncStatus.synced,
			});
			assert.equal(settled?.syncStatus, MailboxSyncStatus.synced);
		});

		test("omitting wherePendingPath predicates on syncStatus alone", async () => {
			const accountId = randomId();
			const mailbox = await repo.create(makeMailboxInput(accountId, "Old"));
			await repo.transition(accountId, mailbox.mailboxId, {
				from: [MailboxSyncStatus.synced],
				to: MailboxSyncStatus.pending,
				set: { pendingPath: "New" },
			});

			const written = await repo.transition(accountId, mailbox.mailboxId, {
				from: [MailboxSyncStatus.pending],
				to: MailboxSyncStatus.failed,
			});
			assert.equal(written?.syncStatus, MailboxSyncStatus.failed);
			assert.equal(written?.pendingPath, "New");
		});

		test("a rename target survives only under pending and failed", async () => {
			// The invariant, over the only writer of either field: a caller that
			// asks for the seventh combination does not get it. `synced` with a
			// rename target on it is what strands a folder whose rename then never
			// runs and is never marked failed.
			const accountId = randomId();
			const mailbox = await repo.create(makeMailboxInput(accountId, "Trips"));

			for (const to of EVERY_STATE) {
				const written = await repo.transition(accountId, mailbox.mailboxId, {
					from: EVERY_STATE,
					to,
					set: { pendingPath: "Holidays" },
				});
				assert.equal(
					written?.pendingPath,
					to === MailboxSyncStatus.pending || to === MailboxSyncStatus.failed
						? "Holidays"
						: undefined,
					`transition to ${to}`,
				);
				assert.deepEqual(
					await repo.get(accountId, mailbox.mailboxId),
					written,
					"what the transition returned is what the row now says",
				);
			}
		});

		test("two overlapping transitions with the same from: exactly one wins", async () => {
			const accountId = randomId();
			const mailbox = await repo.create(makeMailboxInput(accountId, "Races"));

			const outcomes = await Promise.all([
				repo.transition(accountId, mailbox.mailboxId, {
					from: [MailboxSyncStatus.synced],
					to: MailboxSyncStatus.deleting,
				}),
				repo.transition(accountId, mailbox.mailboxId, {
					from: [MailboxSyncStatus.synced],
					to: MailboxSyncStatus.pending,
				}),
			]);

			assert.equal(outcomes.filter((outcome) => outcome !== null).length, 1);
		});

		test("cross-tenant: a foreign account transitions nothing", async () => {
			const accountId = randomId();
			const mailbox = await repo.create(makeMailboxInput(accountId, "Private"));

			assert.equal(
				await repo.transition(randomId(), mailbox.mailboxId, {
					from: EVERY_STATE,
					to: MailboxSyncStatus.deleting,
				}),
				null,
			);
			assert.equal(
				(await repo.get(accountId, mailbox.mailboxId)).syncStatus,
				MailboxSyncStatus.synced,
			);
		});
	});

	describe("transitionSubtree — the intent, all-or-nothing (D6)", () => {
		const seedSubtree = async (accountId: string) => ({
			parent: await repo.create(makeMailboxInput(accountId, "Work")),
			child: await repo.create(makeMailboxInput(accountId, "Work/Projects")),
			grandchild: await repo.create(
				makeMailboxInput(accountId, "Work/Projects/Alpha"),
			),
		});

		test("transitions the folder and every descendant, each from its own path", async () => {
			const accountId = randomId();
			const { parent, child, grandchild } = await seedSubtree(accountId);

			const written = await repo.transitionSubtree(
				accountId,
				parent.mailboxId,
				{
					from: [MailboxSyncStatus.synced, MailboxSyncStatus.failed],
					to: MailboxSyncStatus.pending,
					rowSet: (row) => ({
						pendingPath: row.fullPath.replace("Work", "Archive"),
					}),
				},
			);

			assert.equal(written?.length, 3);
			assert.equal(
				(await repo.get(accountId, parent.mailboxId)).pendingPath,
				"Archive",
			);
			assert.equal(
				(await repo.get(accountId, child.mailboxId)).pendingPath,
				"Archive/Projects",
			);
			assert.equal(
				(await repo.get(accountId, grandchild.mailboxId)).pendingPath,
				"Archive/Projects/Alpha",
			);
		});

		test("one descendant outside `from` refuses the intent and writes nothing", async () => {
			const accountId = randomId();
			const { parent, child, grandchild } = await seedSubtree(accountId);
			await repo.transition(accountId, grandchild.mailboxId, {
				from: [MailboxSyncStatus.synced],
				to: MailboxSyncStatus.deleting,
			});

			const refused = await repo.transitionSubtree(
				accountId,
				parent.mailboxId,
				{
					from: [MailboxSyncStatus.synced],
					to: MailboxSyncStatus.pending,
					rowSet: (row) => ({ pendingPath: `Moved/${row.fullPath}` }),
				},
			);

			assert.equal(refused, null);
			for (const row of [parent, child]) {
				const after = await repo.get(accountId, row.mailboxId);
				assert.equal(after.syncStatus, MailboxSyncStatus.synced);
				assert.equal(after.pendingPath, undefined);
			}
			assert.equal(
				(await repo.get(accountId, grandchild.mailboxId)).syncStatus,
				MailboxSyncStatus.deleting,
			);
		});

		test("the from-state predicate rides each UPDATE, not a prior read", async () => {
			// A read-then-check-then-write version passes the case above and still
			// misses a row that leaves an accepted state after the read. The
			// predicate is on the UPDATE, so the affected-row count catches it.
			const accountId = randomId();
			const { parent, child } = await seedSubtree(accountId);

			const refused = await repo.transitionSubtree(
				accountId,
				parent.mailboxId,
				{
					from: [MailboxSyncStatus.synced],
					to: MailboxSyncStatus.pending,
					rowSet: (row) => {
						if (row.mailboxId === parent.mailboxId) {
							// Not a real concurrent writer — the shape of one. The row
							// leaves `synced` after the subtree was resolved.
							db.update(mailboxTable)
								.set({ syncStatus: MailboxSyncStatus.deleting })
								.where(eq(mailboxTable.mailboxId, child.mailboxId))
								.run();
						}
						return { pendingPath: row.fullPath };
					},
				},
			);

			assert.equal(refused, null);
			assert.equal(
				(await repo.get(accountId, parent.mailboxId)).syncStatus,
				MailboxSyncStatus.synced,
			);
		});

		test("an absent folder is a null", async () => {
			assert.equal(
				await repo.transitionSubtree(randomId(), "no-such-mailbox", {
					from: EVERY_STATE,
					to: MailboxSyncStatus.pending,
					rowSet: () => ({}),
				}),
				null,
			);
		});
	});

	describe("deleteMailboxWithMail — the folder's mail goes with it (D8)", () => {
		const seedMessage = async (mailboxId: string, uid: number) => {
			const messageId = randomId();
			await new DrizzleMessageRepository(db as never).create({
				messageId,
				mailboxId,
				uid,
				sequenceNumber: uid,
				rfc822Size: 10,
				internalDate: 1700000000000,
				envelopeId: deriveEnvelopeId(messageId),
				rootBodyPartId: deriveRootBodyPartId(messageId),
			});
			await db.insert(threadMessageTable).values({
				threadMessageId: randomId(),
				accountConfigId: "acct",
				threadId: randomId(),
				messageId,
				mailboxId,
				uid,
				referenceOrder: 0,
				internalDate: 1700000000000,
				sentDate: 1700000000000,
				isRead: false,
				hasAttachment: false,
				hasStars: false,
				isDeleted: false,
				createdAt: 1700000000000,
				updatedAt: 1700000000000,
			});
			return messageId;
		};

		const outboxEventsFor = async (messageId: string) =>
			db.select().from(outboxTable).where(eq(outboxTable.messageId, messageId));

		test("removes the folder, its mail and its own child rows, and nothing else's", async () => {
			const accountId = randomId();
			const doomed = await repo.create(makeMailboxInput(accountId, "Receipts"));
			const spared = await repo.create(makeMailboxInput(accountId, "Keep"));
			const doomedMessage = await seedMessage(doomed.mailboxId, 1);
			const sparedMessage = await seedMessage(spared.mailboxId, 1);
			await db.insert(mailboxSpecialUseTable).values({
				mailboxSpecialUseId: randomId(),
				mailboxId: doomed.mailboxId,
				specialUse: "Archive",
			});

			await repo.deleteMailboxWithMail(accountId, doomed.mailboxId);

			await assert.rejects(
				() => repo.get(accountId, doomed.mailboxId),
				/Mailbox not found/,
			);
			assert.deepEqual(
				await db
					.select()
					.from(messageTable)
					.where(eq(messageTable.mailboxId, doomed.mailboxId)),
				[],
			);
			assert.deepEqual(
				await db
					.select()
					.from(threadMessageTable)
					.where(eq(threadMessageTable.mailboxId, doomed.mailboxId)),
				[],
			);
			assert.deepEqual(
				await db
					.select()
					.from(mailboxSpecialUseTable)
					.where(eq(mailboxSpecialUseTable.mailboxId, doomed.mailboxId)),
				[],
			);

			// The search index is cleared by the outbox row, not by the delete.
			const removals = await outboxEventsFor(doomedMessage);
			assert.deepEqual(
				removals.map((row) => row.event),
				["message.removed"],
			);

			const survivors = await db
				.select()
				.from(messageTable)
				.where(eq(messageTable.mailboxId, spared.mailboxId));
			assert.equal(survivors.length, 1);
			assert.equal(
				(await outboxEventsFor(sparedMessage)).some(
					(row) => row.event === "message.removed",
				),
				false,
			);
			assert.equal(
				(await repo.get(accountId, spared.mailboxId)).mailboxId,
				spared.mailboxId,
			);
		});

		test("leaves a filter bound to the folder alone", async () => {
			// D16 refuses the delete while a binding stands, so there is nothing to
			// unbind — and deleting a user's filters as a side effect of a folder
			// delete is the outcome the design rules out. This is the test that
			// stops a future refactor doing it.
			const accountId = randomId();
			const mailbox = await repo.create(makeMailboxInput(accountId, "Bound"));
			const filterId = randomId();
			await db.insert(filterTable).values({
				filterId,
				accountConfigId: accountId,
				name: "Invoices → Bound",
				scope: "Standing",
				ruleChangedAt: 0,
				actionChangedAt: 0,
				actionMailboxId: mailbox.mailboxId,
				createdAt: 0,
				updatedAt: 0,
			});

			await repo.deleteMailboxWithMail(accountId, mailbox.mailboxId);

			const rows = await db
				.select()
				.from(filterTable)
				.where(eq(filterTable.filterId, filterId));
			assert.equal(rows.length, 1);
			assert.equal(rows[0].actionMailboxId, mailbox.mailboxId);
		});

		test("re-running after a partial removal completes", async () => {
			const accountId = randomId();
			const mailbox = await repo.create(makeMailboxInput(accountId, "Resume"));
			const first = await seedMessage(mailbox.mailboxId, 1);
			await seedMessage(mailbox.mailboxId, 2);

			// The shape an interruption leaves: one message's rows already gone,
			// the mailbox row still there and still `deleting`.
			await runInTransaction(db, (tx) => deleteMessageSubtree(tx, [first]));
			await repo.transition(accountId, mailbox.mailboxId, {
				from: EVERY_STATE,
				to: MailboxSyncStatus.deleting,
			});

			await repo.deleteMailboxWithMail(accountId, mailbox.mailboxId);

			await assert.rejects(
				() => repo.get(accountId, mailbox.mailboxId),
				/Mailbox not found/,
			);
			assert.deepEqual(
				await db
					.select()
					.from(messageTable)
					.where(eq(messageTable.mailboxId, mailbox.mailboxId)),
				[],
			);
		});

		test("cross-tenant: a foreign account removes neither the row nor its mail", async () => {
			const accountId = randomId();
			const mailbox = await repo.create(makeMailboxInput(accountId, "Mine"));
			await seedMessage(mailbox.mailboxId, 1);

			await repo.deleteMailboxWithMail(randomId(), mailbox.mailboxId);

			assert.equal(
				(await repo.get(accountId, mailbox.mailboxId)).mailboxId,
				mailbox.mailboxId,
			);
			assert.equal(
				(
					await db
						.select()
						.from(messageTable)
						.where(eq(messageTable.mailboxId, mailbox.mailboxId))
				).length,
				1,
			);
		});
	});

	describe("continuation token rejection (#172)", () => {
		for (const [label, token] of [
			["an unparseable", "not-a-cursor"],
			["a bare number", Buffer.from("123").toString("base64url")],
			["a JSON array", Buffer.from("[1,2]").toString("base64url")],
		] as const) {
			test(`${label} token is rejected as a 400`, async () => {
				await assert.rejects(
					() => repo.listByAccount(randomId(), { continuationToken: token }),
					(error: unknown) => {
						assert.equal((error as { statusCode?: number }).statusCode, 400);
						assert.equal((error as Error).name, "BadRequestError");
						return true;
					},
				);
			});
		}
	});
});
