import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import type {
	AccountItem,
	MailboxItem,
	SenderNeverSpamBackApplyEvent,
} from "@remit/data-ports";
import { deriveAddressId } from "@remit/data-ports/id";
import { MessageStatus, PlacementAction } from "@remit/domain-enums";
import {
	backApplyNeverSpam,
	type NeverSpamBackApplyDeps,
} from "./never-spam-back-apply.js";
import { PlacementMoveService } from "./placement-move.js";
import { eml, FakeImapServer } from "./test-helpers/fake-imap.js";
import {
	arriveAt,
	beforeNext,
	openStore,
	recordingQueue,
	type Store,
	seedAccount,
	seedMailbox,
} from "./test-helpers/test-store.js";

const NOW = Date.UTC(2026, 10, 11, 12);
const FRIEND = "friend@example.org";
const STRANGER = "deals@pills.example";

let store: Store;
let imap: FakeImapServer;
let account: AccountItem;
let inbox: MailboxItem;
let junk: MailboxItem;
let receipts: MailboxItem;

beforeEach(async () => {
	store = await openStore();
	imap = new FakeImapServer();
	account = await seedAccount(store);
	inbox = await seedMailbox(store, account, "INBOX");
	junk = await seedMailbox(store, account, "Junk", { specialUse: "Junk" });
	receipts = await seedMailbox(store, account, "Receipts");
	for (const mailbox of [inbox, junk, receipts]) {
		imap.addFolder(mailbox.fullPath);
	}
});

afterEach(async () => {
	await store.close();
});

const inJunk = (from: string): Promise<string> =>
	arriveAt(
		store,
		imap,
		account,
		junk,
		eml({ From: `Someone <${from}>`, Subject: "Hello" }),
	);

const event = (): SenderNeverSpamBackApplyEvent => ({
	type: "SenderNeverSpamBackApply",
	accountConfigId: account.accountConfigId,
	addressId: deriveAddressId(account.accountConfigId, FRIEND),
	normalizedEmail: FRIEND,
});

const grantNeverSpam = () =>
	store.address.mergeFlags(account.accountConfigId, event().addressId, {
		neverSpam: { value: true, setAt: NOW - 1, setBy: "user-1" },
	});

const mover = (): PlacementMoveService =>
	new PlacementMoveService({
		messageService: store.message,
		threadMessageService: store.threadMessage,
		markerService: store.placementMove,
		addressService: store.address,
		mailboxSpecialUseService: store.mailboxSpecialUse,
		mailboxService: store.mailbox,
		queue: recordingQueue(),
	});

const deps = (
	placementMoveService: NeverSpamBackApplyDeps["placementMoveService"] = mover(),
): NeverSpamBackApplyDeps => ({
	accountService: store.account,
	addressService: store.address,
	mailboxSpecialUseService: store.mailboxSpecialUse,
	messageService: store.message,
	placementMoveService,
});

const mailboxOf = async (messageId: string): Promise<string> =>
	(await store.message.get(messageId)).mailboxId;

describe("the never-spam back-apply (#1553)", () => {
	it("moves the sender's Junk mail to the Inbox with a never-spam verdict and leaves other senders", async () => {
		const friendMail = [
			await inJunk(FRIEND),
			await inJunk(FRIEND),
			await inJunk(FRIEND),
		];
		const strangerMail = await inJunk(STRANGER);
		await grantNeverSpam();

		const result = await backApplyNeverSpam(deps(), event(), NOW);

		assert.deepEqual(result, { outcome: "Done", moved: 3, skipped: 0 });
		for (const messageId of friendMail) {
			const row = await store.message.get(messageId);
			assert.equal(row.mailboxId, inbox.mailboxId);
			assert.equal(row.movedByRemit, true);
			assert.equal(row.placementDecidedAt, NOW);
			assert.equal(row.placementVerdict?.action, PlacementAction.MoveToInbox);
			assert.equal(row.placementVerdict?.fromPlacement, "junk");
			assert.deepEqual(row.placementVerdict?.reasons, ["sender=never-spam"]);
		}
		assert.equal(await mailboxOf(strangerMail), junk.mailboxId);
	});

	it("counts a message a user moved after the selection as skipped and leaves it", async () => {
		const messageId = await inJunk(FRIEND);
		await grantNeverSpam();
		const placementMover = mover();
		beforeNext(placementMover, "moveMessage", () =>
			store.message.transitionPlacement(
				messageId,
				{ status: MessageStatus.active, mailboxId: junk.mailboxId },
				{
					mailboxId: receipts.mailboxId,
					originalMailboxId: junk.mailboxId,
				},
			),
		);

		const result = await backApplyNeverSpam(deps(placementMover), event(), NOW);

		assert.deepEqual(result, { outcome: "Done", moved: 0, skipped: 1 });
		const row = await store.message.get(messageId);
		assert.equal(row.mailboxId, receipts.mailboxId);
		assert.equal(row.movedByRemit, false);
		assert.equal(row.placementVerdict, undefined);
	});

	it("moves nothing once the flag is off again before delivery", async () => {
		const messageId = await inJunk(FRIEND);
		await grantNeverSpam();
		await store.address.mergeFlags(account.accountConfigId, event().addressId, {
			neverSpam: null,
		});

		const result = await backApplyNeverSpam(deps(), event(), NOW);

		assert.deepEqual(result, { outcome: "FlagCleared", moved: 0, skipped: 0 });
		assert.equal(await mailboxOf(messageId), junk.mailboxId);
	});
});
