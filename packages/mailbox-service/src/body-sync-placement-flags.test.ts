/**
 * Issue #300 (RFC 039 Decision 3/3a): `Address.flags.blocked`/`autoArchive`
 * were written by the UI and promised in product copy ("Blocked senders...
 * go straight to junk") but `classifyPlacement` never read them. These tests
 * drive `BodySyncService` end-to-end (read-path body materialization →
 * `applyPostStoreSteps` → `resolvePlacement` → the placement move) and assert
 * on the actual move call, so a regression that drops the flag read — not
 * just the `classifyPlacement` branch — shows up here.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type {
	AddressItem,
	IAddressRepository,
	IEnvelopeRepository,
	IMailboxSpecialUseRepository,
	IMessageRepository,
	IThreadMessageRepository,
	UpdateMessageInput,
} from "@remit/data-ports";
import type { StorageService } from "@remit/storage-service";
import type { PlacementConfig } from "./body-sync.js";
import { BodySyncService } from "./body-sync.js";
import type { PlacementMoveService } from "./placement-move.js";
import type { IImapConnection } from "./types.js";

const PLAIN_EML = Buffer.from(
	[
		"From: Sender <someone@example.com>",
		"To: me@example.com",
		"Subject: Hello",
		"Content-Type: text/plain",
		"",
		"body",
	].join("\r\n"),
);

/** Carries the provider-spam + dmarc-pass signals the pre-existing junk→inbox rescue needs (independent of this issue). */
const SPAM_FLAGGED_DMARC_PASS_EML = Buffer.from(
	[
		"From: Sender <someone@example.com>",
		"To: me@example.com",
		"Subject: Hello",
		"Authentication-Results: mx.example.com; dmarc=pass",
		"X-Spam-Status: Yes, score=6.0",
		"Content-Type: text/plain",
		"",
		"body",
	].join("\r\n"),
);

interface MoveCall {
	messageId: string;
	destinationMailboxId: string;
}

interface Harness {
	service: BodySyncService;
	moves: MoveCall[];
	messageUpdates: Array<{ messageId: string; input: UpdateMessageInput }>;
}

const MAILBOXES = {
	inbox: { mailboxId: "mb-inbox", fullPath: "INBOX" },
	junk: { mailboxId: "mb-junk", fullPath: "Junk" },
	archive: { mailboxId: "mb-archive", fullPath: "Archive" },
};

const buildHarness = (
	message: { messageId: string; mailboxId: string; movedByRemit?: boolean },
	flags: AddressItem["flags"],
): Harness => {
	const moves: MoveCall[] = [];
	const messageUpdates: Array<{
		messageId: string;
		input: UpdateMessageInput;
	}> = [];

	const messageService = {
		get: async () => ({ ...message, uid: 1 }),
		update: async (messageId: string, input: UpdateMessageInput) => {
			messageUpdates.push({ messageId, input });
		},
	} as unknown as IMessageRepository;

	const threadMessageService = {
		findAllByMessageId: async () => [
			{
				threadMessageId: "tm-1",
				sentDate: 1,
				mailboxId: message.mailboxId,
				isRead: false,
				isDeleted: false,
				hasStars: false,
				hasAttachment: false,
			},
		],
		update: async () => {},
	} as unknown as IThreadMessageRepository;

	const storageService = {
		storeMessageBody: async () => ({ uri: "s3://bodies/m-1" }),
		storeParsedBody: async () => {},
		listBodyParts: async () => [],
	} as unknown as StorageService;

	const addressService = {
		getAddress: async () => ({ flags }) as unknown as AddressItem,
		incrementInboundCount: async () => {},
	} as unknown as IAddressRepository;

	const envelopeService = {
		listBodyParts: async () => [],
	} as unknown as IEnvelopeRepository;

	const mailboxSpecialUseService = {
		findJunkMailbox: async () => MAILBOXES.junk,
		findArchiveMailbox: async () => MAILBOXES.archive,
		findInboxMailbox: async () => MAILBOXES.inbox,
	} as unknown as IMailboxSpecialUseRepository;

	const placementMoveService = {
		moveMessage: async (
			_accountConfigId: string,
			messageId: string,
			destinationMailboxId: string,
		) => {
			moves.push({ messageId, destinationMailboxId });
		},
	} as unknown as PlacementMoveService;

	const placementConfig: PlacementConfig = {
		mailboxSpecialUseService,
		placementMoveService,
	};

	const service = new BodySyncService(
		messageService,
		storageService,
		threadMessageService,
		addressService,
		envelopeService,
		{ info: () => {}, error: () => {} },
		placementConfig,
	);

	return { service, moves, messageUpdates };
};

const readBody = async (
	service: BodySyncService,
	mailboxPath = "INBOX",
	body: Buffer = PLAIN_EML,
) => {
	const connection = {
		openBox: async () => {},
		fetchMessageBody: async () => body,
	} as unknown as IImapConnection;
	return service.fetchAndGetBody(
		"m-1",
		"acc-1",
		"cfg-1",
		mailboxPath,
		async () => connection,
	);
};

const flagsAt = (
	setAt: number,
): { blocked: { value: true; setAt: number } } => ({
	blocked: { value: true, setAt },
});

describe("Address.flags.blocked drives placement (issue #300)", () => {
	it("moves an inbox message from a blocked sender to junk, with no DKIM/DMARC signal at all", async () => {
		const harness = buildHarness(
			{ messageId: "m-1", mailboxId: MAILBOXES.inbox.mailboxId },
			flagsAt(1_000),
		);

		await readBody(harness.service);

		assert.deepEqual(harness.moves, [
			{ messageId: "m-1", destinationMailboxId: MAILBOXES.junk.mailboxId },
		]);
		assert.equal(harness.messageUpdates[0]?.input.movedByRemit, true);
	});

	it("does not move a blocked sender's message already sitting in junk", async () => {
		const harness = buildHarness(
			{ messageId: "m-1", mailboxId: MAILBOXES.junk.mailboxId },
			flagsAt(1_000),
		);

		await readBody(harness.service, "Junk");

		assert.deepEqual(harness.moves, []);
	});

	it("leaves an unflagged sender's inbox message alone", async () => {
		const harness = buildHarness(
			{ messageId: "m-1", mailboxId: MAILBOXES.inbox.mailboxId },
			{},
		);

		await readBody(harness.service);

		assert.deepEqual(harness.moves, []);
	});

	describe("Decision 3a: setAt tie-break against vip/wellknown", () => {
		it("demotes when blocked is set after vip", async () => {
			const harness = buildHarness(
				{ messageId: "m-1", mailboxId: MAILBOXES.inbox.mailboxId },
				{
					vip: { value: true, setAt: 1_000 },
					blocked: { value: true, setAt: 5_000 },
				},
			);

			await readBody(harness.service);

			assert.deepEqual(harness.moves, [
				{ messageId: "m-1", destinationMailboxId: MAILBOXES.junk.mailboxId },
			]);
		});

		it("rescues (does not demote) when vip is set after blocked, from junk", async () => {
			const harness = buildHarness(
				{ messageId: "m-1", mailboxId: MAILBOXES.junk.mailboxId },
				{
					blocked: { value: true, setAt: 1_000 },
					vip: { value: true, setAt: 5_000 },
				},
			);

			// Provider-spam + dmarc-pass is the pre-existing rescue's own low bar,
			// independent of this issue — carried by the fixture so the only thing
			// under test is whether the newer `vip` correctly suppresses `blocked`'s
			// demote.
			await readBody(harness.service, "Junk", SPAM_FLAGGED_DMARC_PASS_EML);

			assert.deepEqual(harness.moves, [
				{ messageId: "m-1", destinationMailboxId: MAILBOXES.inbox.mailboxId },
			]);
		});
	});
});

describe("Address.flags.autoArchive drives placement (issue #300)", () => {
	it("files an inbox message from an autoArchive sender straight to Archive", async () => {
		const harness = buildHarness(
			{ messageId: "m-1", mailboxId: MAILBOXES.inbox.mailboxId },
			{ autoArchive: { value: true, setAt: 1_000 } },
		);

		await readBody(harness.service);

		assert.deepEqual(harness.moves, [
			{
				messageId: "m-1",
				destinationMailboxId: MAILBOXES.archive.mailboxId,
			},
		]);
	});

	it("does not move an autoArchive sender's message already sitting in Archive", async () => {
		const harness = buildHarness(
			{ messageId: "m-1", mailboxId: MAILBOXES.archive.mailboxId },
			{ autoArchive: { value: true, setAt: 1_000 } },
		);

		await readBody(harness.service, "Archive");

		assert.deepEqual(harness.moves, []);
	});

	it("a confident blocked-demote takes priority over autoArchive", async () => {
		const harness = buildHarness(
			{ messageId: "m-1", mailboxId: MAILBOXES.inbox.mailboxId },
			{
				blocked: { value: true, setAt: 1_000 },
				autoArchive: { value: true, setAt: 1_000 },
			},
		);

		await readBody(harness.service);

		assert.deepEqual(harness.moves, [
			{ messageId: "m-1", destinationMailboxId: MAILBOXES.junk.mailboxId },
		]);
	});
});

/**
 * Issue #398: not every `leave` verdict means "nothing confident to say".
 * `already-moved-by-remit` is the guard against re-deciding a settled
 * placement, and mail sitting in Junk gets a `leave` because the demote branch
 * only fires outside Junk. Auto-archive is a filing preference relative to the
 * Inbox and must yield to both, so these drive `BodySyncService` end-to-end and
 * assert on the absence of a move.
 */
describe("autoArchive respects a leave verdict that decided something (issue #398)", () => {
	it("leaves a blocked autoArchive sender's message in Junk", async () => {
		const harness = buildHarness(
			{ messageId: "m-1", mailboxId: MAILBOXES.junk.mailboxId },
			{
				blocked: { value: true, setAt: 1_000 },
				autoArchive: { value: true, setAt: 1_000 },
			},
		);

		await readBody(harness.service, "Junk");

		assert.deepEqual(harness.moves, []);
	});

	it("leaves an autoArchive sender's provider-junked message in Junk", async () => {
		const harness = buildHarness(
			{ messageId: "m-1", mailboxId: MAILBOXES.junk.mailboxId },
			{ autoArchive: { value: true, setAt: 1_000 } },
		);

		// Provider-spam + dmarc-pass from an untrusted sender is an unsure
		// `leave`: too weak to rescue, and auto-archive is not a second chance
		// at leaving Junk.
		await readBody(harness.service, "Junk", SPAM_FLAGGED_DMARC_PASS_EML);

		assert.deepEqual(harness.moves, []);
	});

	it("leaves a message Remit already placed alone on a re-entrant pass", async () => {
		const harness = buildHarness(
			{
				messageId: "m-1",
				mailboxId: MAILBOXES.inbox.mailboxId,
				movedByRemit: true,
			},
			{ autoArchive: { value: true, setAt: 1_000 } },
		);

		await readBody(harness.service);

		assert.deepEqual(harness.moves, []);
	});
});
