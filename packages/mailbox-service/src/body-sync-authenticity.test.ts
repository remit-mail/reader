/**
 * #603 CI review: every prior test for the Authentication-Results-preferred
 * authenticity signal called `extractAuthenticity` directly — never through
 * `BodySyncService`'s real production entry point (`classifyMessage`, reached
 * via `fetchAndGetBody` / `syncBodies`), and never asserted on the placement
 * decision that signal drives. A regression that reads ordinary relayed mail
 * (a mailing list, a corporate gateway) as a mismatch would pass every unit
 * test on `extractAuthenticity` alone while still moving that mail to Junk in
 * production, on a real IMAP connection to a mailbox other clients also
 * touch. This drives the real entry point end to end: a raw `.eml`, fetched
 * over IMAP, classified by the actual service, and asserts both the
 * `authenticity` object it writes and the move decision it makes.
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
	MessageItem,
	UpdateMessageInput,
} from "@remit/data-ports";
import { MailboxSpecialUse } from "@remit/domain-enums";
import type { StorageService } from "@remit/storage-service";
import type { PlacementConfig } from "./body-sync.js";
import { BodySyncService } from "./body-sync.js";
import type { PlacementMoveService } from "./placement-move.js";
import type { IImapConnection } from "./types.js";

const MAILBOXES = {
	inbox: { mailboxId: "mb-inbox", fullPath: "INBOX" },
	junk: { mailboxId: "mb-junk", fullPath: "Junk" },
};

/**
 * A message relayed through a re-signing host (issue #603: reader used to
 * store the delivery host's own re-signature, custmx.one.com, as the signing
 * domain — the sender's actual signature, server104.greatnet.de, was only
 * visible in Authentication-Results). Both the raw signature and
 * Authentication-Results agree this does not align with the From domain, so
 * this exercises the "which domain gets displayed" fix without touching the
 * mismatch/demote question.
 */
const RELAYED_EML = Buffer.from(
	[
		"From: alice@sabrinabasten.com",
		"To: bob@example.com",
		"Subject: relayed",
		"Authentication-Results: mx.custmx.one.com; dkim=pass header.d=server104.greatnet.de header.s=sel",
		"DKIM-Signature: v=1; a=rsa-sha256; d=custmx.one.com; s=sel; b=xxx",
		"Content-Type: text/plain",
		"",
		"body",
	].join("\r\n"),
);

/**
 * The CI review's regression case: a Google Groups mailing list. The list
 * footer Google appends breaks the author's own DKIM signature, so
 * Authentication-Results — which only lists what actually re-verified —
 * shows only googlegroups.com passing, not acme.com. The raw headers still
 * carry both signatures, including the original, aligned one. Preferring
 * Authentication-Results for the mismatch question alone would read this as
 * a forgery and, with the DMARC failure every such list produces, move
 * ordinary list mail to Junk.
 */
const MAILING_LIST_EML = Buffer.from(
	[
		"From: Alice <alice@acme.com>",
		"To: list@googlegroups.com",
		"Subject: hi",
		"Authentication-Results: mx.google.com; dkim=pass header.d=googlegroups.com; spf=pass smtp.mailfrom=googlegroups.com; dmarc=fail (p=REJECT) header.from=acme.com",
		"DKIM-Signature: v=1; a=rsa-sha256; d=acme.com; s=sel; b=xxx",
		"DKIM-Signature: v=1; a=rsa-sha256; d=googlegroups.com; s=sel2; b=yyy",
		"X-Spam-Status: No, score=0.2",
		"Content-Type: text/plain",
		"",
		"body",
	].join("\r\n"),
);

/**
 * The deterministic demote signal set (DKIM mismatch, dmarc=fail, untrusted
 * sender, a provider-spam header present) `classifyPlacement`'s demote
 * branch confidently acts on — mirrors `DEMOTE_EML` in
 * `body-sync-placement-writeonce.test.ts`, kept here too so the demote path
 * has its own authenticity-focused coverage alongside the regression case
 * above.
 */
const PHISH_EML = Buffer.from(
	[
		"From: Support <support@evil-mimic.example>",
		"To: me@example.com",
		"Subject: Verify your account",
		"Authentication-Results: mx.example.com; dmarc=fail",
		"DKIM-Signature: v=1; a=rsa-sha256; d=relay.example.net; s=sel; b=xxx",
		"X-Spam-Status: No, score=0.1",
		"Content-Type: text/plain",
		"",
		"body",
	].join("\r\n"),
);

/**
 * Pre-merge review, adversarial case 1: the unanchored regex that used to
 * read the dkim= verdict matched a "dkim=fail" token sitting inside arc=
 * fail's own comment — there is no dkim= result of its own in this header
 * at all. The provider's filter said not-spam.
 */
const UNANCHORED_MATCH_EML = Buffer.from(
	[
		"From: Bob <bob@smallshop.nl>",
		"Authentication-Results: mx.example.net; arc=fail (i=1 spf=pass dkim=fail",
		"  dkimdomain=smallshop.nl dmarc=fail); spf=pass smtp.mailfrom=smallshop.nl;",
		"  dmarc=fail header.from=smallshop.nl",
		"X-Spam-Status: No, score=0.1",
		"To: me@example.com",
		"Subject: hi",
		"",
		"body",
	].join("\r\n"),
);

/**
 * Pre-merge review, adversarial case 2: a corporate gateway that verifies a
 * signature, finds the body hash broken by an intermediate relay, and
 * reports dkim=fail — but still names the sender's own domain in header.d.
 * The same relay class this PR set out to protect.
 */
const GATEWAY_STRIPPED_SIG_EML = Buffer.from(
	[
		"From: Alice <alice@acme.com>",
		"To: bob@example.com",
		"Subject: hi",
		"Authentication-Results: gw.corp.example; dkim=fail (body hash did not verify)",
		"  header.d=acme.com; spf=pass; dmarc=fail (p=REJECT) header.from=acme.com",
		"X-Spam-Status: No, score=0.1",
		"",
		"body",
	].join("\r\n"),
);

interface Harness {
	service: BodySyncService;
	message: MessageItem;
	messageUpdates: Array<{ messageId: string; input: UpdateMessageInput }>;
	moves: Array<{ messageId: string; destinationMailboxId: string }>;
}

const buildHarness = (
	message: Partial<MessageItem> & Pick<MessageItem, "messageId">,
	retrieve: () => Promise<Buffer>,
): Harness => {
	const messageUpdates: Array<{
		messageId: string;
		input: UpdateMessageInput;
	}> = [];
	const moves: Array<{ messageId: string; destinationMailboxId: string }> = [];

	const messageRow = {
		uid: 1,
		mailboxId: MAILBOXES.inbox.mailboxId,
		...message,
	} as unknown as MessageItem;

	const messageService = {
		get: async () => messageRow,
		update: async (messageId: string, input: UpdateMessageInput) => {
			messageUpdates.push({ messageId, input });
			Object.assign(messageRow, input);
		},
	} as unknown as IMessageRepository;

	const threadMessageService = {
		findAllByMessageId: async () => [
			{
				threadMessageId: "tm-1",
				messageId: message.messageId,
				mailboxId: messageRow.mailboxId,
				sentDate: 1,
				isRead: false,
				isDeleted: false,
				hasStars: false,
				hasAttachment: false,
			},
		],
		update: async () => {},
	} as unknown as IThreadMessageRepository;

	const storageService = {
		retrieve,
		storeMessageBody: async () => ({ uri: `s3://bodies/${message.messageId}` }),
		storeMessageBodyStream: async () => ({
			uri: `s3://bodies/${message.messageId}`,
		}),
		storeParsedBody: async () => {},
		listBodyParts: async () => [],
	} as unknown as StorageService;

	const addressService = {
		getAddress: async () => ({ flags: {} }) as unknown as AddressItem,
		incrementInboundCount: async () => {},
	} as unknown as IAddressRepository;

	const envelopeService = {
		listBodyParts: async () => [],
	} as unknown as IEnvelopeRepository;

	const mailboxSpecialUseService = {
		findBySpecialUse: async (_accountId: string, specialUse: string) =>
			specialUse === MailboxSpecialUse.Junk ? MAILBOXES.junk : null,
		findInboxMailbox: async () => MAILBOXES.inbox,
	} as unknown as IMailboxSpecialUseRepository;

	const placementMoveService = {
		moveMessage: async (
			_accountConfigId: string,
			messageId: string,
			destinationMailboxId: string,
		) => {
			moves.push({ messageId, destinationMailboxId });
			messageRow.mailboxId = destinationMailboxId;
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

	return { service, message: messageRow, messageUpdates, moves };
};

const runFresh = async (eml: Buffer): Promise<Harness> => {
	const harness = buildHarness(
		{
			messageId: "m-1",
			mailboxId: MAILBOXES.inbox.mailboxId,
			movedByRemit: false,
		},
		async () => {
			throw new Error("no body stored yet; must not retrieve");
		},
	);
	const connection = {
		openBox: async () => {},
		fetchMessageBody: async () => eml,
	} as unknown as IImapConnection;
	await harness.service.fetchAndGetBody(
		"m-1",
		"acc-1",
		"cfg-1",
		"INBOX",
		async () => connection,
	);
	return harness;
};

describe("authenticity, driven through the real production entry point", () => {
	it("prefers Authentication-Results' domain over the raw DKIM-Signature's for a relayed message", async () => {
		const harness = await runFresh(RELAYED_EML);

		assert.deepEqual(harness.messageUpdates[0]?.input.authenticity, {
			fromDomain: "sabrinabasten.com",
			dkimDomain: "server104.greatnet.de",
			dkimMismatch: true,
		});
	});

	// The CI review's regression: this must NOT move to Junk. Preferring
	// Authentication-Results for the mismatch question (not just the
	// displayed domain) would read this as a forgery and, combined with the
	// DMARC failure every such list produces, move it — a real IMAP mutation
	// on a mailbox other clients also touch, for mail the provider's own
	// filter did not call spam.
	it("does not move a legitimately relayed mailing-list message to Junk", async () => {
		const harness = await runFresh(MAILING_LIST_EML);

		assert.deepEqual(
			harness.messageUpdates[0]?.input.authenticity,
			{
				fromDomain: "acme.com",
				dkimDomain: "googlegroups.com",
				dkimMismatch: false,
			},
			"the raw signature's alignment on acme.com must clear the mismatch",
		);
		assert.deepEqual(
			harness.moves,
			[],
			"ordinary relayed list mail must not be moved to Junk",
		);
	});

	it("still moves a genuine phishing message to Junk", async () => {
		const harness = await runFresh(PHISH_EML);

		assert.deepEqual(harness.moves, [
			{ messageId: "m-1", destinationMailboxId: MAILBOXES.junk.mailboxId },
		]);
		assert.equal(
			harness.messageUpdates[0]?.input.authenticity?.dkimMismatch,
			true,
		);
	});

	it("does not move mail to Junk over a dkim=fail token embedded in an unrelated mechanism's comment", async () => {
		const harness = await runFresh(UNANCHORED_MATCH_EML);

		assert.deepEqual(
			harness.moves,
			[],
			"there is no dkim= result in this header at all",
		);
	});

	it("does not move mail to Junk when a gateway's dkim=fail names the sender's own domain", async () => {
		const harness = await runFresh(GATEWAY_STRIPPED_SIG_EML);

		assert.deepEqual(
			harness.moves,
			[],
			"a failure naming the claimed domain itself is relay noise, not forgery",
		);
		assert.equal(
			harness.messageUpdates[0]?.input.authenticity?.dkimMismatch,
			false,
		);
	});
});
