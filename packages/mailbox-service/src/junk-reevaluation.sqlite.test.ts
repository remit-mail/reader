import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import type {
	AccountItem,
	CreateMessageInput,
	MailboxItem,
} from "@remit/data-ports";
import {
	AccountSettingName,
	ClassificationLabel,
	MessageStatus,
	PlacementAction,
	PlacementConfidence,
} from "@remit/domain-enums";
import type { StorageService } from "@remit/storage-service";
import {
	JUNK_REEVALUATION_LOCK,
	type JunkBacklogDeps,
	reevaluateJunkBacklog,
} from "./junk-reevaluation.js";
import { PlacementMoveService } from "./placement-move.js";
import {
	classifierDecision,
	classifierSecrets,
	saveClassifierProvider,
} from "./test-helpers/classifier-stub.js";
import { eml } from "./test-helpers/fake-imap.js";
import {
	type StubHttpServer,
	type StubReply,
	startStubHttpServer,
} from "./test-helpers/stub-http-server.js";
import {
	openStore,
	recordingQueue,
	type Store,
	seedAccount,
	seedMailbox,
	seedMessage,
	silentLog,
	storeBody,
} from "./test-helpers/test-store.js";

const DAY_ONE = Date.UTC(2026, 10, 10, 12);
const DAY_TWO = DAY_ONE + 24 * 60 * 60 * 1000;

const NEWSLETTER = eml(
	{
		From: "Dutch Cycling Weekly <news@dutchcyclingweekly.nl>",
		Subject: "This week in cycling",
		"List-Unsubscribe": "<https://dutchcyclingweekly.nl/unsub>",
	},
	"Ten rides for the autumn.",
);

const PILLS = eml(
	{ From: "Pharmacy <deals@pills.example>", Subject: "Cheap pills" },
	"Buy now.",
);

interface World {
	store: Store;
	storage: StorageService;
	account: AccountItem;
	inbox: MailboxItem;
	junk: MailboxItem;
	receipts: MailboxItem;
	provider: StubHttpServer;
	reply: StubReply;
}

let world: World;
let nextUid = 1;

beforeEach(async () => {
	const store = await openStore();
	const account = await seedAccount(store);
	world = {
		store,
		storage: store.storage(),
		account,
		inbox: await seedMailbox(store, account, "INBOX"),
		junk: await seedMailbox(store, account, "Junk", { specialUse: "Junk" }),
		receipts: await seedMailbox(store, account, "Receipts"),
		provider: await startStubHttpServer(() => world.reply),
		reply: classifierDecision([[ClassificationLabel.Newsletter, 0.9]]),
	};
	await saveClassifierProvider(
		store.accountSetting,
		account.accountConfigId,
		world.provider.baseUrl,
	);
});

afterEach(async () => {
	await world.provider.close();
	await world.store.close();
});

const inJunk = async (
	raw: Buffer,
	message: Partial<CreateMessageInput> = {},
): Promise<string> => {
	const { message: seeded } = await seedMessage(
		world.store,
		world.account,
		world.junk,
		nextUid++,
		{ message },
	);
	await storeBody(
		world.store,
		world.storage,
		world.account,
		seeded.messageId,
		raw,
	);
	return seeded.messageId;
};

const placementMover = (): PlacementMoveService => {
	const { store } = world;
	return new PlacementMoveService({
		messageService: store.message,
		threadMessageService: store.threadMessage,
		markerService: store.placementMove,
		addressService: store.address,
		mailboxSpecialUseService: store.mailboxSpecialUse,
		mailboxService: store.mailbox,
		queue: recordingQueue(),
	});
};

const deps = (
	placementMoveService: JunkBacklogDeps["placementMoveService"] = placementMover(),
): JunkBacklogDeps => {
	const { store } = world;
	return {
		mailboxSpecialUseService: store.mailboxSpecialUse,
		mailboxService: store.mailbox,
		mailboxLockService: store.mailboxLock,
		messageService: store.message,
		addressService: store.address,
		storageService: world.storage,
		placementMoveService,
		classifierConfig: {
			accountSetting: store.accountSetting,
			accountConfig: store.accountConfig,
			classificationDefault: { state: "None" },
			secrets: classifierSecrets,
			labelService: store.label,
			messageLabelService: store.messageLabel,
			logger: silentLog,
		},
		log: silentLog,
	};
};

const deliver = async (now: number): Promise<void> => {
	await reevaluateJunkBacklog(deps(), world.account, now);
};

const mailboxOf = async (messageId: string): Promise<string> =>
	(await world.store.message.get(messageId)).mailboxId;

describe("the Junk backlog re-check (#1553)", () => {
	it("moves a newsletter to the Inbox and records the verdict", async () => {
		const messageId = await inJunk(NEWSLETTER);

		await deliver(DAY_ONE);

		const row = await world.store.message.get(messageId);
		assert.equal(row.mailboxId, world.inbox.mailboxId);
		assert.equal(row.movedByRemit, true);
		assert.equal(row.placementVerdict?.action, PlacementAction.MoveToInbox);
		assert.equal(row.placementVerdict?.fromPlacement, "junk");
		assert.equal(row.placementDecidedAt, DAY_ONE);
	});

	it("leaves classifier spam, reported, user-moved and Remit-moved mail in Junk", async () => {
		const spam = await inJunk(PILLS);
		const reported = await inJunk(NEWSLETTER, {
			spamReport: { reportedAt: 1 },
		});
		const userMoved = await inJunk(NEWSLETTER, {
			originalMailboxId: world.inbox.mailboxId,
		});
		const remitMoved = await inJunk(NEWSLETTER, { movedByRemit: true });
		world.reply = classifierDecision([[ClassificationLabel.Spam, 0.95]]);

		await deliver(DAY_ONE);

		for (const messageId of [spam, reported, userMoved, remitMoved]) {
			assert.equal(await mailboxOf(messageId), world.junk.mailboxId);
		}
		const judged = await world.store.message.get(spam);
		assert.equal(judged.placementVerdict?.action, PlacementAction.MoveToJunk);
		assert.deepEqual(judged.placementVerdict?.reasons, ["classifier=spam"]);
		for (const messageId of [reported, userMoved, remitMoved]) {
			const row = await world.store.message.get(messageId);
			assert.equal(row.placementDecidedAt, undefined);
		}
		assert.equal(
			world.provider.requests.length,
			1,
			"only the unplaced message spends the classifier budget",
		);
	});

	it("stops at the classifier limit and resumes the next day", async () => {
		await world.store.accountSetting.upsert({
			accountConfigId: world.account.accountConfigId,
			name: AccountSettingName.ClassificationDailyLimit,
			value: { kind: "Number", value: 1 },
		});
		const messages = [await inJunk(NEWSLETTER), await inJunk(NEWSLETTER)];
		const inInbox = async (): Promise<number> =>
			(await Promise.all(messages.map(mailboxOf))).filter(
				(mailboxId) => mailboxId === world.inbox.mailboxId,
			).length;

		await deliver(DAY_ONE);

		assert.equal(await inInbox(), 1);

		await deliver(DAY_ONE);

		assert.equal(await inInbox(), 1);
		assert.equal(world.provider.requests.length, 1);

		await deliver(DAY_TWO);

		assert.equal(await inInbox(), 2);
		assert.equal(world.provider.requests.length, 2);
	});

	it("leaves the backlog alone while another delivery holds the lease", async () => {
		const messageId = await inJunk(NEWSLETTER);
		await world.store.mailboxLock.tryAcquireLock(
			world.junk.mailboxId,
			JUNK_REEVALUATION_LOCK,
			world.account.accountId,
			"first-delivery",
			60,
		);

		const result = await reevaluateJunkBacklog(deps(), world.account, DAY_ONE);

		assert.deepEqual(result, { outcome: "Busy", examined: 0, moved: 0 });
		const row = await world.store.message.get(messageId);
		assert.equal(row.mailboxId, world.junk.mailboxId);
		assert.equal(row.placementDecidedAt, undefined);
		assert.equal(world.provider.requests.length, 0);
	});

	it("re-judges messages the pre-#1568 rules left in Junk", async () => {
		const left = await inJunk(NEWSLETTER, { placementDecidedAt: DAY_ONE - 1 });
		const judgedAsInbox = await inJunk(NEWSLETTER, {
			placementDecidedAt: DAY_ONE - 1,
			placementVerdict: {
				action: PlacementAction.MoveToJunk,
				confidence: PlacementConfidence.Unsure,
				fromPlacement: "inbox",
				reasons: ["provider=spam"],
				dryRun: false,
				decidedAt: DAY_ONE - 1,
			},
		});

		await deliver(DAY_ONE);

		for (const messageId of [left, judgedAsInbox]) {
			const row = await world.store.message.get(messageId);
			assert.equal(row.mailboxId, world.inbox.mailboxId);
			assert.equal(row.placementVerdict?.fromPlacement, "junk");
		}
	});

	it("moves nothing on a second run", async () => {
		const kept = await inJunk(PILLS);
		world.reply = classifierDecision([[ClassificationLabel.Spam, 0.95]]);
		await deliver(DAY_ONE);
		world.reply = classifierDecision([[ClassificationLabel.Newsletter, 0.9]]);

		await deliver(DAY_TWO);

		assert.equal(await mailboxOf(kept), world.junk.mailboxId);
		assert.equal(world.provider.requests.length, 1);
	});

	it("lets a user move made after the selection win, and records no verdict", async () => {
		const messageId = await inJunk(NEWSLETTER);
		const mover = placementMover();
		const outcomes: string[] = [];
		const userMovesFirst: JunkBacklogDeps["placementMoveService"] = {
			moveMessage: async (...args) => {
				const row = await world.store.message.get(messageId);
				await world.store.message.transitionPlacement(
					messageId,
					{ status: MessageStatus.active, mailboxId: row.mailboxId },
					{
						mailboxId: world.receipts.mailboxId,
						originalMailboxId: row.mailboxId,
					},
				);
				const outcome = await mover.moveMessage(...args);
				outcomes.push(outcome);
				return outcome;
			},
		};

		await reevaluateJunkBacklog(deps(userMovesFirst), world.account, DAY_ONE);

		assert.deepEqual(outcomes, ["skipped"]);
		const row = await world.store.message.get(messageId);
		assert.equal(row.mailboxId, world.receipts.mailboxId);
		assert.equal(row.placementVerdict, undefined);
		assert.equal(row.placementDecidedAt, undefined);
		assert.equal(row.movedByRemit, false);
	});
});
