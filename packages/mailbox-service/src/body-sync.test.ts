import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import { DEFAULT_CALENDAR_URL_SEGMENT } from "@remit/calendar-service";
import type {
	AccountItem,
	AddressFlags,
	MailboxItem,
	UpdateMessageInput,
} from "@remit/data-ports";
import {
	MessageGoneFromServerError,
	MessagePlacementUnsettledError,
} from "@remit/data-ports/errors";
import { deriveAddressId } from "@remit/data-ports/id";
import {
	CalendarInviteMethod,
	CalendarSource,
	CalendarSuggestionState,
	FilterClauseField,
	FilterScope,
	MessageCategory,
	MessageClassificationState,
} from "@remit/domain-enums";
import type { StorageService } from "@remit/storage-service";
import {
	type BodySyncFolder,
	type BodySyncLogger,
	BodySyncService,
} from "./body-sync.js";
import { NO_ACTION } from "./filters/match.js";
import { FlagPushService } from "./flag-push.js";
import { FlagQueueService } from "./flag-queue.js";
import { PlacementMoveService } from "./placement-move.js";
import { QuarantineService } from "./quarantine.js";
import { SyncWarningService } from "./sync-warning.js";
import { eml, FakeImapServer } from "./test-helpers/fake-imap.js";
import {
	messageAtUid,
	openStore,
	type RecordingQueue,
	recordingQueue,
	type Store,
	seedAccount,
	seedMailbox,
	silentLog,
	syncFolder,
} from "./test-helpers/test-store.js";

const LINKEDIN = eml(
	{
		From: "LinkedIn <messages-noreply@linkedin.com>",
		Subject: "You have a new invitation",
		"List-Id": "LinkedIn Invitations <invitations.linkedin.com>",
		"List-Unsubscribe": "<https://www.linkedin.com/e/unsub>",
	},
	"invitation body text",
);

const PERSONAL = eml(
	{ From: "Alex <alex@example.com>", Subject: "Dinner Friday?" },
	"Are you free Friday night?",
);

const DEMOTE = eml({
	From: "Support <support@evil-mimic.example>",
	Subject: "Verify your account",
	"Authentication-Results": "mx.example.com; dmarc=fail",
	"DKIM-Signature": "v=1; a=rsa-sha256; d=relay.example.net; s=sel; b=xxx",
	"X-Spam-Status": "No, score=0.1",
});

const SPAM_FLAGGED_DMARC_PASS = eml({
	From: "Sender <someone@example.com>",
	"Authentication-Results": "mx.example.com; dmarc=pass",
	"X-Spam-Status": "Yes, score=6.0",
});

const FROM_SOMEONE = eml({ From: "Sender <someone@example.com>" });

const TRAVEL_INVITATION = eml({
	From: "Someone <someone@example.com>",
	Subject: "You have a new invitation to Travel",
});

const ICAL_UID = "invite-4711@example.test";

const invitation = (
	sequence = 0,
	method = "REQUEST",
	start = "DTSTART:20260901T080000Z",
): Buffer =>
	Buffer.from(
		[
			"From: Organizer <organizer@example.test>",
			"To: user@example.test",
			"Subject: Quarterly review",
			'Content-Type: multipart/alternative; boundary="bnd"',
			"",
			"--bnd",
			"Content-Type: text/plain",
			"",
			"You are invited.",
			"--bnd",
			`Content-Type: text/calendar; method=${method}; charset="UTF-8"`,
			"",
			"BEGIN:VCALENDAR",
			"VERSION:2.0",
			"PRODID:-//Example Corp//Scheduler//EN",
			`METHOD:${method}`,
			"BEGIN:VEVENT",
			`UID:${ICAL_UID}`,
			"DTSTAMP:20260801T090000Z",
			`SEQUENCE:${sequence}`,
			start,
			"SUMMARY:Quarterly review",
			"ORGANIZER:mailto:organizer@example.test",
			"END:VEVENT",
			"END:VCALENDAR",
			"--bnd--",
			"",
		].join("\r\n"),
	);

const MISSING_BODY = "file:///nonexistent/remit/body.eml";

interface World {
	store: Store;
	imap: FakeImapServer;
	queue: RecordingQueue;
	account: AccountItem;
	inbox: MailboxItem;
	junk: MailboxItem;
	archive: MailboxItem;
	travel: MailboxItem;
}

let world: World;

beforeEach(async () => {
	const store = await openStore();
	const account = await seedAccount(store);
	const imap = new FakeImapServer();
	for (const path of ["INBOX", "Junk", "Archive", "Travel"])
		imap.addFolder(path);
	world = {
		store,
		imap,
		queue: recordingQueue(),
		account,
		inbox: await seedMailbox(store, account, "INBOX"),
		junk: await seedMailbox(store, account, "Junk", { specialUse: "Junk" }),
		archive: await seedMailbox(store, account, "Archive", {
			specialUse: "Archive",
		}),
		travel: await seedMailbox(store, account, "Travel"),
	};
});

afterEach(async () => {
	await world.store.close();
});

interface Wiring {
	storage?: StorageService;
	log?: BodySyncLogger;
	placement?: boolean;
	filters?: boolean;
	quarantine?: boolean;
	unsubscribe?: boolean;
	calendar?: boolean;
}

const bodySync = (wiring: Wiring = {}): BodySyncService => {
	const { store } = world;
	const placementMoveService = new PlacementMoveService({
		messageService: store.message,
		threadMessageService: store.threadMessage,
		markerService: store.placementMove,
		addressService: store.address,
		mailboxSpecialUseService: store.mailboxSpecialUse,
		mailboxService: store.mailbox,
		queue: world.queue,
	});
	const flagQueueService = new FlagQueueService({
		messageFlagService: store.messageFlag,
		messageService: store.message,
		threadMessageService: store.threadMessage,
		flagPushService: new FlagPushService({
			markerService: store.flagPush,
			queue: world.queue.fifo,
		}),
	});
	return new BodySyncService(
		store.message,
		wiring.storage ?? store.storage(),
		store.threadMessage,
		store.address,
		store.envelope,
		new SyncWarningService(store.syncWarning),
		wiring.log ?? silentLog,
		wiring.placement
			? {
					mailboxSpecialUseService: store.mailboxSpecialUse,
					placementMoveService,
				}
			: undefined,
		wiring.filters
			? {
					filterService: store.filter,
					messageLabelService: store.messageLabel,
					mailboxService: store.mailbox,
					placementMoveService,
				}
			: undefined,
		wiring.quarantine
			? {
					quarantineService: new QuarantineService(
						store.quarantine,
						store.mailboxSpecialUse,
						"sha-test",
						silentLog,
					),
					mailboxId: world.inbox.mailboxId,
					uidValidity: world.inbox.uidValidity,
					attempts: 1,
				}
			: undefined,
		wiring.unsubscribe ? { flagQueueService } : undefined,
		wiring.calendar
			? {
					calendarSuggestionService: store.calendarSuggestion,
					calendarStore: store.calendarStore,
					filterService: store.filter,
				}
			: undefined,
	);
};

const placementOf = (mailbox: MailboxItem): BodySyncFolder => ({
	mailboxId: mailbox.mailboxId,
	fullPath: mailbox.fullPath,
	placement:
		mailbox === world.inbox
			? "inbox"
			: mailbox === world.junk
				? "junk"
				: "other",
});

const arrive = async (
	raw: Buffer,
	mailbox: MailboxItem = world.inbox,
	update: UpdateMessageInput = {},
): Promise<string> => {
	const uid = world.imap.deliver(mailbox.fullPath, raw);
	await syncFolder(world.store, world.account, mailbox, world.imap);
	const { messageId } = await messageAtUid(world.store, mailbox, uid);
	await world.store.message.update(messageId, update);
	return messageId;
};

const read = (
	service: BodySyncService,
	messageId: string,
	mailbox: MailboxItem = world.inbox,
) =>
	service.fetchAndGetBody(
		messageId,
		world.account.accountId,
		world.account.accountConfigId,
		placementOf(mailbox),
		async () => world.imap.connection(),
	);

const sync = (
	service: BodySyncService,
	messageIds: string[],
	options: {
		force?: boolean;
		mailbox?: MailboxItem;
		concurrency?: number;
	} = {},
) =>
	service.syncBodies(
		messageIds,
		world.account.accountId,
		world.account.accountConfigId,
		{
			...placementOf(options.mailbox ?? world.inbox),
			uidValidity: (options.mailbox ?? world.inbox).uidValidity,
		},
		async () => world.imap.connection(),
		{ force: options.force ?? false, concurrency: options.concurrency ?? 1 },
	);

const flagSender = async (email: string, flags: AddressFlags) => {
	const [localPart, domain] = email.split("@");
	const addressId = deriveAddressId(world.account.accountConfigId, email);
	await world.store.address.upsertAddress({
		addressId,
		accountConfigId: world.account.accountConfigId,
		localPart,
		domain,
		normalizedEmail: email,
		normalizedCompound: email,
	});
	await world.store.address.updateAddress(
		world.account.accountConfigId,
		addressId,
		{ flags },
	);
};

const messageRow = (messageId: string) => world.store.message.get(messageId);

const threadRows = (messageId: string) =>
	world.store.threadMessage.findAllByMessageId(
		world.account.accountConfigId,
		messageId,
	);

const addFilter = (
	clauses: Array<{ field: string; value: string }>,
	actionMailboxId: string = NO_ACTION,
	actionLabelId: string = NO_ACTION,
) =>
	world.store.filter.create({
		accountConfigId: world.account.accountConfigId,
		name: "rule",
		scope: FilterScope.Standing,
		literalClauses: clauses as never,
		actionMailboxId,
		actionLabelId,
	});

describe("classification is decided on the pass that first stores a body", () => {
	it("writes the category, the examined mark and every denormalized field", async () => {
		const messageId = await arrive(LINKEDIN);
		await world.store.threadMessage.create({
			...(await threadRows(messageId))[0],
			threadId: "drifted-root",
		});

		await sync(bodySync(), [messageId]);

		const row = await messageRow(messageId);
		assert.equal(row.category, MessageCategory.social);
		assert.equal(row.classificationState, MessageClassificationState.Examined);
		assert.ok(row.bodyStorageKey);
		const rows = await threadRows(messageId);
		assert.equal(rows.length, 2);
		for (const thread of rows) {
			assert.equal(thread.category, MessageCategory.social);
			assert.equal(thread.listId, "invitations.linkedin.com");
			assert.equal(thread.snippet, "invitation body text");
		}
	});

	it("examines a body the classifier has nothing to say about once", async () => {
		const messageId = await arrive(PERSONAL);
		const service = bodySync();

		await sync(service, [messageId]);
		const second = await sync(service, [messageId]);

		assert.equal(second.skippedCount, 1);
		const row = await messageRow(messageId);
		assert.equal(row.classificationState, MessageClassificationState.Examined);
	});

	it("leaves mail stored before the classifier ran for the backfill to find", async () => {
		const messageId = await arrive(LINKEDIN, world.inbox, {
			bodyStorageKey: MISSING_BODY,
			classificationState: MessageClassificationState.NotExamined,
		});

		const result = await sync(bodySync(), [messageId]);

		assert.equal(result.skippedCount, 1);
		const row = await messageRow(messageId);
		assert.equal(
			row.classificationState,
			MessageClassificationState.NotExamined,
		);
		assert.equal(row.category, MessageCategory.uncategorized);
	});

	it("classifies by the sender's category override instead of the headers", async () => {
		await flagSender("messages-noreply@linkedin.com", {
			category: { value: MessageCategory.personal, setAt: 1 },
		});
		const messageId = await arrive(LINKEDIN);

		await read(bodySync(), messageId);

		assert.equal(
			(await messageRow(messageId)).category,
			MessageCategory.personal,
		);
		assert.equal(
			(await threadRows(messageId))[0].category,
			MessageCategory.personal,
		);
	});

	it("does not reach back to examined mail when the sender is reclassified later", async () => {
		const messageId = await arrive(LINKEDIN, world.inbox, {
			bodyStorageKey: MISSING_BODY,
			classificationState: MessageClassificationState.Examined,
		});
		await flagSender("messages-noreply@linkedin.com", {
			category: { value: MessageCategory.transactional, setAt: 1 },
		});

		await sync(bodySync(), [messageId]);

		assert.equal(
			(await messageRow(messageId)).category,
			MessageCategory.uncategorized,
		);
	});
});

describe("a re-store re-fetches bytes and re-decides nothing", () => {
	const decidedRow = (
		overrides: UpdateMessageInput = {},
	): UpdateMessageInput => ({
		bodyStorageKey: MISSING_BODY,
		category: MessageCategory.marketing,
		classificationState: MessageClassificationState.Examined,
		placementDecidedAt: 500,
		...overrides,
	});

	for (const path of ["the missing-object read", "a forced sync"] as const) {
		const restore = (
			service: BodySyncService,
			messageId: string,
			mailbox: MailboxItem = world.inbox,
		) =>
			path === "a forced sync"
				? sync(service, [messageId], { force: true, mailbox })
				: read(service, messageId, mailbox);

		it(`keeps category, placement and read state through ${path}`, async () => {
			await flagSender("support@evil-mimic.example", {
				category: { value: MessageCategory.personal, setAt: 1 },
				unsubscribed: { value: true, setAt: 1 },
			});
			const messageId = await arrive(DEMOTE, world.inbox, decidedRow());

			await restore(
				bodySync({ placement: true, filters: true, unsubscribe: true }),
				messageId,
			);

			const row = await messageRow(messageId);
			assert.notEqual(row.bodyStorageKey, MISSING_BODY);
			assert.equal(row.category, MessageCategory.marketing);
			assert.equal(row.mailboxId, world.inbox.mailboxId);
			assert.equal(row.movedByRemit, false);
			assert.equal(row.placementDecidedAt, 500);
			assert.equal((await threadRows(messageId))[0].isRead, false);
			assert.deepEqual(world.queue.sent, []);
		});

		it(`does not re-fire a standing filter through ${path}`, async () => {
			await addFilter(
				[{ field: FilterClauseField.Subject, value: "invitation" }],
				world.junk.mailboxId,
			);
			const messageId = await arrive(
				TRAVEL_INVITATION,
				world.travel,
				decidedRow(),
			);

			await restore(bodySync({ filters: true }), messageId, world.travel);

			const row = await messageRow(messageId);
			assert.equal(row.mailboxId, world.travel.mailboxId);
			assert.equal(row.filterMove, undefined);
		});

		it(`makes the re-stored body findable by a word in it through ${path}`, async () => {
			const messageId = await arrive(PERSONAL, world.inbox, decidedRow());

			await restore(bodySync(), messageId);

			const found = await world.store.threadMessage.searchByDate(
				world.account.accountConfigId,
				{ query: "night" },
				{ mailboxIds: new Set([world.inbox.mailboxId]) },
			);
			assert.deepEqual(
				found.items.map((item) => item.messageId),
				[messageId],
			);
		});
	}

	it("first-stores the never-stored message of a forced batch with the full pass", async () => {
		await addFilter(
			[{ field: FilterClauseField.Subject, value: "invitation" }],
			world.travel.mailboxId,
		);
		const stored = await arrive(DEMOTE, world.inbox, decidedRow());
		const fresh = await arrive(TRAVEL_INVITATION);

		const result = await sync(
			bodySync({ placement: true, filters: true }),
			[stored, fresh],
			{ force: true },
		);

		assert.deepEqual(result.syncedMessageIds.sort(), [fresh, stored].sort());
		assert.equal((await messageRow(stored)).mailboxId, world.inbox.mailboxId);
		const filed = await messageRow(fresh);
		assert.equal(filed.mailboxId, world.travel.mailboxId);
		assert.equal(filed.movedByRemit, true);
	});
});

describe("placement follows the sender's flags", () => {
	it("files a blocked sender's inbox mail to Junk with no authentication signal", async () => {
		await flagSender("someone@example.com", {
			blocked: { value: true, setAt: 1_000 },
		});
		const messageId = await arrive(FROM_SOMEONE);

		await read(bodySync({ placement: true }), messageId);

		const row = await messageRow(messageId);
		assert.equal(row.mailboxId, world.junk.mailboxId);
		assert.equal(row.movedByRemit, true);
		assert.ok(row.placementDecidedAt);
		assert.equal(
			(await world.store.placementMove.find(messageId))?.state,
			"queued",
		);
		assert.deepEqual(
			world.queue.sent.map((event) => event.body.type),
			["PLACEMENT_MOVE_PUSH"],
		);
	});

	it("leaves an unflagged sender's inbox mail where it is", async () => {
		const messageId = await arrive(FROM_SOMEONE);

		await read(bodySync({ placement: true }), messageId);

		assert.equal(
			(await messageRow(messageId)).mailboxId,
			world.inbox.mailboxId,
		);
		assert.equal(await world.store.placementMove.find(messageId), null);
	});

	it("rescues from Junk when vip was set after blocked", async () => {
		await flagSender("someone@example.com", {
			blocked: { value: true, setAt: 1_000 },
			vip: { value: true, setAt: 5_000 },
		});
		const messageId = await arrive(SPAM_FLAGGED_DMARC_PASS, world.junk);

		await read(bodySync({ placement: true }), messageId, world.junk);

		assert.equal(
			(await messageRow(messageId)).mailboxId,
			world.inbox.mailboxId,
		);
	});

	it("files an autoArchive sender's inbox mail to Archive", async () => {
		await flagSender("someone@example.com", {
			autoArchive: { value: true, setAt: 1_000 },
		});
		const messageId = await arrive(FROM_SOMEONE);

		await read(bodySync({ placement: true }), messageId);

		assert.equal(
			(await messageRow(messageId)).mailboxId,
			world.archive.mailboxId,
		);
	});

	it("lets a blocked demote win over autoArchive", async () => {
		await flagSender("someone@example.com", {
			blocked: { value: true, setAt: 1_000 },
			autoArchive: { value: true, setAt: 1_000 },
		});
		const messageId = await arrive(FROM_SOMEONE);

		await read(bodySync({ placement: true }), messageId);

		assert.equal((await messageRow(messageId)).mailboxId, world.junk.mailboxId);
	});

	it("does not auto-archive mail out of Junk", async () => {
		await flagSender("someone@example.com", {
			autoArchive: { value: true, setAt: 1_000 },
		});
		const messageId = await arrive(SPAM_FLAGGED_DMARC_PASS, world.junk);

		await read(bodySync({ placement: true }), messageId, world.junk);

		assert.equal((await messageRow(messageId)).mailboxId, world.junk.mailboxId);
	});

	it("does not re-file mail Remit already placed", async () => {
		await flagSender("someone@example.com", {
			autoArchive: { value: true, setAt: 1_000 },
		});
		const messageId = await arrive(FROM_SOMEONE, world.inbox, {
			movedByRemit: true,
		});

		await read(bodySync({ placement: true }), messageId);

		assert.equal(
			(await messageRow(messageId)).mailboxId,
			world.inbox.mailboxId,
		);
	});
});

describe("a standing filter runs on the first store", () => {
	it("moves the message and records where it came from", async () => {
		const filter = await addFilter(
			[{ field: FilterClauseField.Subject, value: "invitation" }],
			world.travel.mailboxId,
		);
		const messageId = await arrive(TRAVEL_INVITATION);

		await read(bodySync({ filters: true }), messageId);

		const row = await messageRow(messageId);
		assert.equal(row.mailboxId, world.travel.mailboxId);
		assert.equal(row.movedByRemit, true);
		assert.deepEqual(
			{
				filterId: row.filterMove?.filterId,
				sourceMailboxId: row.filterMove?.sourceMailboxId,
				destinationMailboxId: row.filterMove?.destinationMailboxId,
			},
			{
				filterId: filter.filterId,
				sourceMailboxId: world.inbox.mailboxId,
				destinationMailboxId: world.travel.mailboxId,
			},
		);
	});

	it("records no move for a message already in the filter's destination", async () => {
		await addFilter(
			[{ field: FilterClauseField.Subject, value: "invitation" }],
			world.travel.mailboxId,
		);
		const messageId = await arrive(TRAVEL_INVITATION, world.travel);

		await read(bodySync({ filters: true }), messageId, world.travel);

		const row = await messageRow(messageId);
		assert.equal(row.filterMove, undefined);
		assert.equal(row.movedByRemit, false);
	});
});

describe("an unsubscribed sender's mail is marked read once", () => {
	it("marks it read on the first store", async () => {
		await flagSender("someone@example.com", {
			unsubscribed: { value: true, setAt: 1 },
		});
		const messageId = await arrive(FROM_SOMEONE);

		await read(bodySync({ unsubscribe: true }), messageId);

		assert.equal((await threadRows(messageId))[0].isRead, true);
		assert.ok(
			await world.store.flagPush.find(messageId, "\\Seen"),
			"the read owes IMAP a \\Seen push",
		);
	});

	it("leaves read state alone once the flag is unset", async () => {
		await flagSender("someone@example.com", {
			unsubscribed: { value: false, setAt: 1 },
		});
		const messageId = await arrive(FROM_SOMEONE);

		await read(bodySync({ unsubscribe: true }), messageId);

		assert.equal((await threadRows(messageId))[0].isRead, false);
	});
});

describe("reading a message the mail server no longer holds", () => {
	const gone = async (inFlight = false) => {
		const messageId = await arrive(FROM_SOMEONE);
		const { uid } = await messageRow(messageId);
		if (inFlight) {
			await world.store.message.transitionPlacement(
				messageId,
				{ status: "active" },
				{ status: "moving", syncStatus: "pending" },
			);
		}
		world.imap.expunge("INBOX", uid);
		const outcome = await read(bodySync(), messageId).then(
			() => assert.fail("expected the read to be refused"),
			(error: unknown) => error,
		);
		return { messageId, outcome };
	};

	it("answers 404 and removes the settled row with its thread entries", async () => {
		const { messageId, outcome } = await gone();

		assert.ok(outcome instanceof MessageGoneFromServerError);
		assert.equal(outcome.statusCode, 404);
		await assert.rejects(messageRow(messageId));
		assert.deepEqual(await threadRows(messageId), []);
	});

	it("answers 409 and deletes nothing while our own move is in flight", async () => {
		const { messageId, outcome } = await gone(true);

		assert.ok(outcome instanceof MessagePlacementUnsettledError);
		assert.equal(outcome.statusCode, 409);
		assert.equal((await threadRows(messageId)).length, 1);
	});

	it("answers 409 when another writer moved the row while the server was asked", async () => {
		const messageId = await arrive(FROM_SOMEONE);
		const { uid } = await messageRow(messageId);
		world.imap.expunge("INBOX", uid);
		world.imap.onFetchBody = async () => {
			await world.store.message.transitionPlacement(
				messageId,
				{ status: "active" },
				{ mailboxId: world.travel.mailboxId, uid: 99 },
			);
		};

		await assert.rejects(
			read(bodySync(), messageId),
			MessagePlacementUnsettledError,
		);
		assert.equal((await threadRows(messageId)).length, 1);
	});

	it("fails loudly and deletes nothing when the server still lists the UID", async () => {
		const messageId = await arrive(FROM_SOMEONE);
		const connection = world.imap.connection();
		connection.fetchMessageBody = async () => null;

		await assert.rejects(
			bodySync().fetchAndGetBody(
				messageId,
				world.account.accountId,
				world.account.accountConfigId,
				placementOf(world.inbox),
				async () => connection,
			),
			/which the server still lists/,
		);
		assert.ok(await messageRow(messageId));
	});
});

describe("body sync and the quarantine", () => {
	it("skips a uid already set aside without fetching it", async () => {
		const messageId = await arrive(FROM_SOMEONE);
		const { uid } = await messageRow(messageId);
		await new QuarantineService(
			world.store.quarantine,
			world.store.mailboxSpecialUse,
			"sha-test",
			silentLog,
		).record(
			{
				accountId: world.account.accountId,
				accountConfigId: world.account.accountConfigId,
				mailboxId: world.inbox.mailboxId,
				mailboxPath: "INBOX",
				uidValidity: world.inbox.uidValidity,
				attempts: 3,
			},
			uid,
			{ stage: "BodyParse", code: "UnreadableBody", message: "boundary" },
		);

		const result = await bodySync({ quarantine: true }).syncBodies(
			[messageId],
			world.account.accountId,
			world.account.accountConfigId,
			{ ...placementOf(world.inbox), uidValidity: world.inbox.uidValidity },
			async () => assert.fail("a quarantined message is not fetched"),
			{ force: false, concurrency: 1 },
		);

		assert.equal(result.skippedCount, 1);
		assert.equal((await messageRow(messageId)).bodyStorageKey, undefined);
	});

	it("requeues a storage failure rather than calling the message unreadable", async () => {
		const messageId = await arrive(FROM_SOMEONE);

		await assert.rejects(
			sync(
				bodySync({ quarantine: true, storage: world.store.brokenStorage() }),
				[messageId],
			),
		);

		assert.deepEqual(
			await world.store.quarantine.listByAccountConfigId(
				world.account.accountConfigId,
			),
			[],
		);
		assert.equal((await messageRow(messageId)).bodyStorageKey, undefined);
	});
});

describe("mail-derived calendar suggestions", () => {
	const suggestions = (messageId: string) =>
		world.store.calendarSuggestion.listByMessage(
			world.account.accountConfigId,
			messageId,
		);

	it("offers an invitation as one Pending card carrying its bytes", async () => {
		const messageId = await arrive(invitation());

		await read(bodySync({ calendar: true }), messageId);

		const [row, ...rest] = await suggestions(messageId);
		assert.deepEqual(rest, []);
		assert.equal(row.state, CalendarSuggestionState.Pending);
		assert.equal(row.icalUid, ICAL_UID);
		assert.equal(row.method, CalendarInviteMethod.Request);
		assert.equal(row.organizer, "organizer@example.test");
		assert.match(row.icalData, /UID:invite-4711@example\.test/);
	});

	it("reads a floating start in the collection's own zone", async () => {
		await world.store.calendarCollection.create({
			accountConfigId: world.account.accountConfigId,
			urlSegment: DEFAULT_CALENDAR_URL_SEGMENT,
			displayName: "Calendar",
			source: CalendarSource.Default,
			timezone: "Europe/Amsterdam",
		});
		const messageId = await arrive(
			invitation(0, "REQUEST", "DTSTART:20260901T100000"),
		);

		await read(bodySync({ calendar: true }), messageId);

		const [row] = await suggestions(messageId);
		assert.equal(row.dtStart, "2026-09-01T10:00:00+02:00");
		assert.equal(row.zoneCertainty, "Local");
	});

	it("offers no card for a sender the user muted", async () => {
		await addFilter([
			{ field: FilterClauseField.From, value: "organizer@example.test" },
		]);
		const messageId = await arrive(invitation());

		await read(bodySync({ calendar: true }), messageId);

		assert.deepEqual(await suggestions(messageId), []);
	});

	it("still offers a card when the rule about this sender files its mail", async () => {
		await addFilter(
			[{ field: FilterClauseField.From, value: "organizer@example.test" }],
			world.travel.mailboxId,
		);
		const messageId = await arrive(invitation());

		await read(bodySync({ calendar: true }), messageId);

		assert.equal((await suggestions(messageId)).length, 1);
	});

	it("offers nothing on a re-store", async () => {
		const messageId = await arrive(invitation(), world.inbox, {
			bodyStorageKey: MISSING_BODY,
		});

		await read(bodySync({ calendar: true }), messageId);

		assert.deepEqual(await suggestions(messageId), []);
	});

	it("supersedes the earlier revision when a higher SEQUENCE arrives", async () => {
		const service = bodySync({ calendar: true });
		const first = await arrive(invitation(0));
		const second = await arrive(invitation(1));

		await read(service, first);
		await read(service, second);

		assert.equal(
			(await suggestions(first))[0].state,
			CalendarSuggestionState.Superseded,
		);
		assert.equal(
			(await suggestions(second))[0].state,
			CalendarSuggestionState.Pending,
		);
	});

	it("offers a cancellation as its own card", async () => {
		const messageId = await arrive(invitation(1, "CANCEL"));

		await read(bodySync({ calendar: true }), messageId);

		const [row] = await suggestions(messageId);
		assert.equal(row.method, CalendarInviteMethod.Cancel);
		assert.equal(row.acceptedCalendarObjectId, "");
	});

	it("stores the body when the iCalendar is unreadable", async () => {
		const messageId = await arrive(
			Buffer.from(
				[
					"From: Organizer <organizer@example.test>",
					'Content-Type: multipart/alternative; boundary="bnd"',
					"",
					"--bnd",
					"Content-Type: text/calendar",
					"",
					"BEGIN:VCALENDAR",
					"--bnd--",
					"",
				].join("\r\n"),
			),
		);

		await read(bodySync({ calendar: true }), messageId);

		assert.ok((await messageRow(messageId)).bodyStorageKey);
		assert.deepEqual(await suggestions(messageId), []);
	});
});

describe("a batch is stored with bounded concurrency", () => {
	const recordingLog = (): BodySyncLogger & { messages: string[] } => {
		const messages: string[] = [];
		const record = (_obj: Record<string, unknown>, msg: string) => {
			messages.push(msg);
		};
		return { messages, info: record, warn: record, error: record };
	};

	const arriveBatch = async (size: number, tag: string): Promise<string[]> => {
		const messageIds: string[] = [];
		for (let i = 0; i < size; i++) {
			messageIds.push(
				await arrive(
					eml(
						{ From: `Sender ${i} <s${i}@example.com>`, Subject: `${tag} ${i}` },
						`body ${tag} ${i}`,
					),
				),
			);
		}
		return messageIds;
	};

	const storedEvents = (log: { messages: string[] }) =>
		log.messages.filter((msg) => msg === "Body stored").length;

	it("stores the same set at concurrency 1 and 4", async () => {
		const serialLog = recordingLog();
		const serialIds = await arriveBatch(6, "serial");
		const serial = await sync(bodySync({ log: serialLog }), serialIds, {
			concurrency: 1,
		});

		const parallelLog = recordingLog();
		const parallelIds = await arriveBatch(6, "parallel");
		const parallel = await sync(bodySync({ log: parallelLog }), parallelIds, {
			concurrency: 4,
		});

		assert.deepEqual(serial.syncedMessageIds, serialIds);
		assert.deepEqual(parallel.syncedMessageIds, parallelIds);
		assert.equal(storedEvents(serialLog), 6);
		assert.equal(storedEvents(parallelLog), 6);
		for (const messageId of [...serialIds, ...parallelIds]) {
			assert.ok((await messageRow(messageId)).bodyStorageKey);
		}
	});

	it("stores every neighbour of a message whose store fails", async () => {
		const messageIds = await arriveBatch(5, "neighbours");
		const failing = messageIds[1];
		const working = world.store.storage();
		const broken = world.store.brokenStorage();
		const storage: StorageService = {
			...working,
			storeMessageBody: (params) =>
				(params.messageId === failing ? broken : working).storeMessageBody(
					params,
				),
		};
		const log = recordingLog();

		await assert.rejects(
			sync(bodySync({ storage, log }), messageIds, { concurrency: 4 }),
		);

		assert.equal((await messageRow(failing)).bodyStorageKey, undefined);
		for (const messageId of messageIds.filter((id) => id !== failing)) {
			assert.ok((await messageRow(messageId)).bodyStorageKey);
		}
		assert.equal(storedEvents(log), 4);
	});
});
