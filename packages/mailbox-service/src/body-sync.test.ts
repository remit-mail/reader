import assert from "node:assert/strict";
import { Readable } from "node:stream";
import { after, before, describe, it } from "node:test";
import {
	AddressService,
	type BodyPartItem,
	type EnvelopeService,
	type MailboxSpecialUseService,
	type MessageService,
	NotFoundError,
	type ThreadMessageService,
	type UpdateMessageInput,
} from "@remit/remit-electrodb-service";
import {
	MailboxSpecialUse,
	MessageCategory,
	PlacementAction,
	PlacementConfidence,
	SenderTrust,
} from "@remit/domain-enums";
import type {
	StorageReference,
	StorageService,
	StoreBodyPartParams,
	StoreMessageBodyParams,
	StoreParsedBodyParams,
} from "@remit/storage-service";
import { type BodySyncLogger, BodySyncService } from "./body-sync.js";
import type { MessageMoveService } from "./message-move.js";
import { type IImapConnection, MailConnectionError } from "./types.js";

const A_RAW_EML = Buffer.from(
	[
		"From: a@example.com",
		"To: b@example.com",
		"Subject: hi",
		"Message-ID: <abc@example.com>",
		"Content-Type: text/plain",
		"",
		"hello world body",
		"",
	].join("\r\n"),
);

const NEWSLETTER_EML = Buffer.from(
	[
		"From: news@news.example.com",
		"To: bob@example.com",
		"Subject: weekly digest",
		"Message-ID: <news-1@news.example.com>",
		"List-Id: <weekly.news.example.com>",
		"List-Unsubscribe: <https://news.example.com/u>",
		"Content-Type: text/plain",
		"",
		"weekly digest body",
		"",
	].join("\r\n"),
);

interface FakeStateOptions {
	messageId: string;
	hasBodyStorageKey?: boolean;
	rawEml?: Buffer;
	bodyParts?: BodyPartItem[];
	messageOverrides?: Record<string, unknown>;
}

const buildFakeState = (opts: FakeStateOptions) => {
	const storedBodies: StoreMessageBodyParams[] = [];
	const storedParsed: StoreParsedBodyParams[] = [];
	const storedBodyParts: StoreBodyPartParams[] = [];
	const updatedKeys: Array<{ messageId: string } & UpdateMessageInput> = [];
	const threadSnippetUpdates: Array<{
		threadMessageId: string;
		category?: string;
		snippet?: string;
	}> = [];
	const inboundIncrements: Array<{ addressId: string; now: number }> = [];
	const counts = {
		retrieve: 0,
		bodyPartExists: 0,
		listBodyParts: 0,
		upsertBodyPartContents: 0,
	};

	const message = {
		messageId: opts.messageId,
		mailboxId: "mbx-1",
		uid: 42,
		messageIdHeader: "<abc@example.com>",
		bodyStorageKey: opts.hasBodyStorageKey
			? "s3://bucket/accounts/acc-cfg-1/acc-1/messages/msg-1/body.eml"
			: undefined,
		...opts.messageOverrides,
	};

	const messageService = {
		get: async (id: string) => {
			assert.equal(id, opts.messageId);
			return message;
		},
		update: async (id: string, input: UpdateMessageInput): Promise<unknown> => {
			updatedKeys.push({ messageId: id, ...input });
			if (input.bodyStorageKey) {
				message.bodyStorageKey = input.bodyStorageKey;
			}
			return message;
		},
	} as unknown as MessageService;

	const addressService = {
		incrementInboundCount: async (
			_accountConfigId: string,
			addressId: string,
			now: number,
		) => {
			inboundIncrements.push({ addressId, now });
		},
	} as unknown as AddressService;

	const threadMessageService = {
		getByMessageId: async () => ({
			threadMessageId: "tm-1",
			messageId: opts.messageId,
		}),
		update: async (
			_accountConfigId: string,
			threadMessageId: string,
			input: { category?: string; snippet?: string },
		) => {
			threadSnippetUpdates.push({
				threadMessageId,
				category: input.category,
				snippet: input.snippet,
			});
			return {};
		},
	} as unknown as ThreadMessageService;

	const storageService: StorageService = {
		storeMessageBody: async (params): Promise<StorageReference> => {
			storedBodies.push(params);
			return {
				uri: `s3://bucket/accounts/${params.accountConfigId}/${params.accountId}/messages/${params.messageId}/body.eml`,
				storageType: "s3",
				storageLocation: "bucket",
				storageKey: `accounts/${params.accountConfigId}/${params.accountId}/messages/${params.messageId}/body.eml`,
				sizeBytes: params.content.length,
				checksumSha256: "x",
				contentEncoding: "gzip",
			};
		},
		storeMessageBodyStream: async (params): Promise<StorageReference> => {
			const chunks: Buffer[] = [];
			for await (const chunk of params.content) {
				chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
			}
			const content = Buffer.concat(chunks);
			storedBodies.push({
				accountConfigId: params.accountConfigId,
				accountId: params.accountId,
				messageId: params.messageId,
				content,
			});
			return {
				uri: `s3://bucket/accounts/${params.accountConfigId}/${params.accountId}/messages/${params.messageId}/body.eml`,
				storageType: "s3",
				storageLocation: "bucket",
				storageKey: `accounts/${params.accountConfigId}/${params.accountId}/messages/${params.messageId}/body.eml`,
				sizeBytes: content.length,
				checksumSha256: "x",
				contentEncoding: "gzip",
			};
		},
		storeBodyPart: async (params): Promise<StorageReference> => {
			storedBodyParts.push(params);
			return {
				uri: `s3://bucket/accounts/${params.accountConfigId}/${params.accountId}/messages/${params.messageId}/parts/${params.partPath}`,
				storageType: "s3",
				storageLocation: "bucket",
				storageKey: `accounts/${params.accountConfigId}/${params.accountId}/messages/${params.messageId}/parts/${params.partPath}`,
				sizeBytes: params.content.length,
				checksumSha256: "x",
				contentEncoding: "none",
			};
		},
		bodyPartExists: async (accountConfigId, accountId, messageId, partPath) => {
			counts.bodyPartExists++;
			return storedBodyParts.some(
				(p) =>
					p.accountConfigId === accountConfigId &&
					p.accountId === accountId &&
					p.messageId === messageId &&
					p.partPath === partPath,
			);
		},
		storeDeduplicated: async () => {
			throw new Error("not used");
		},
		storeParsedBody: async (params): Promise<StorageReference> => {
			storedParsed.push(params);
			return {
				uri: `s3://bucket/accounts/${params.accountConfigId}/${params.accountId}/messages/${params.messageId}/parsed.json.gz`,
				storageType: "s3",
				storageLocation: "bucket",
				storageKey: `accounts/${params.accountConfigId}/${params.accountId}/messages/${params.messageId}/parsed.json.gz`,
				sizeBytes: 0,
				checksumSha256: "x",
				contentEncoding: "gzip",
			};
		},
		retrieveParsedBody: async () => null,
		retrieveMessageBody: async () => null,
		retrieveMessageBodyStream: async () => null,
		retrieve: async () => {
			counts.retrieve++;
			return opts.rawEml ?? A_RAW_EML;
		},
		exists: async () => true,
		delete: async () => {},
		storeExportArchiveStream: async () => {
			throw new Error("not used");
		},
		getPresignedDownloadUrl: async () => {
			throw new Error("not supported");
		},
	};

	const envelopeService = {
		listBodyParts: async (id: string): Promise<BodyPartItem[]> => {
			counts.listBodyParts++;
			assert.equal(id, opts.messageId);
			return opts.bodyParts ?? [];
		},
		upsertBodyPartContents: async () => {
			counts.upsertBodyPartContents++;
		},
	} as unknown as EnvelopeService;

	return {
		messageService,
		threadMessageService,
		storageService,
		addressService,
		envelopeService,
		storedBodies,
		storedParsed,
		storedBodyParts,
		updatedKeys,
		threadSnippetUpdates,
		inboundIncrements,
		counts,
	};
};

interface FakeConnectionCalls {
	openBoxCount: number;
	fetchBatchCount: number;
	fetchedUidBatches: number[][];
}

/**
 * Fake IMAP connection for the pipelined body-fetch path.
 *
 * `bodies` maps each UID to its raw .eml. `fetchMessageBodies` yields each as a
 * fresh stream — and records the UID batch so a test can assert ONE ranged
 * FETCH per batch. `openBox` is counted so a test can assert ONE SELECT.
 */
const buildFakeConnection = (
	rawEml?: Buffer,
	opts?: {
		bodies?: Map<number, Buffer>;
		dropAfter?: number;
		dropError?: unknown;
		calls?: FakeConnectionCalls;
	},
): IImapConnection => {
	const bodies = opts?.bodies ?? new Map([[42, rawEml ?? A_RAW_EML]]);
	const calls = opts?.calls;
	// Default to the exact shape `fetchMessageBodies` rethrows after classifying
	// imapflow's mid-stream `EConnectionClosed` — a typed MailConnectionError.
	const dropError =
		opts?.dropError ??
		new MailConnectionError(
			"network",
			"IMAP connection failed: EConnectionClosed",
		);

	return {
		openBox: async () => {
			if (calls) calls.openBoxCount++;
			return {};
		},
		fetchMessageBody: async () => rawEml ?? A_RAW_EML,
		fetchMessageBodies: async function* (uids: number[]) {
			if (calls) {
				calls.fetchBatchCount++;
				calls.fetchedUidBatches.push([...uids]);
			}
			let yielded = 0;
			for (const uid of uids) {
				if (opts?.dropAfter !== undefined && yielded >= opts.dropAfter) {
					throw dropError;
				}
				const body = bodies.get(uid);
				if (!body) continue;
				yield { uid, source: Readable.from(body) };
				yielded++;
			}
		},
		// Other interface methods are unused in these tests; cast to avoid
		// implementing the entire IMAP surface.
	} as unknown as IImapConnection;
};

describe("BodySyncService.syncBodies (parsed-body cache)", () => {
	it("writes BOTH body.eml and parsed.json.gz on a successful body fetch", async () => {
		const fake = buildFakeState({ messageId: "msg-1" });
		const service = new BodySyncService(
			fake.messageService,
			fake.storageService,
			fake.threadMessageService,
			fake.addressService,
			fake.envelopeService,
		);

		const result = await service.syncBodies(
			["msg-1"],
			"acc-1",
			"acc-cfg-1",
			"INBOX",
			async () => buildFakeConnection(),
		);

		assert.equal(result.syncedCount, 1);
		assert.equal(fake.storedBodies.length, 1);
		assert.equal(fake.storedParsed.length, 1);

		const cached = fake.storedParsed[0];
		assert.equal(cached.accountConfigId, "acc-cfg-1");
		assert.equal(cached.accountId, "acc-1");
		assert.equal(cached.messageId, "msg-1");
		assert.equal(typeof cached.parsed.text, "string");
		assert.ok(cached.parsed.text?.includes("hello world body"));
		assert.ok(Array.isArray(cached.parsed.attachments));
	});

	it("does NOT report synced when the parsed-cache write throws; requeues the message", async () => {
		// A parsed-body write failure used to be swallowed, leaving the message
		// marked synced while parsedBody was null — a silent search-index gap.
		// Now it must fail the message so it lands in failedMessageIds and the
		// SQS batch requeues it.
		const fake = buildFakeState({ messageId: "msg-1" });
		const failingStorage: StorageService = {
			...fake.storageService,
			storeParsedBody: async () => {
				throw new Error("simulated S3 outage");
			},
		};
		const service = new BodySyncService(
			fake.messageService,
			failingStorage,
			fake.threadMessageService,
			fake.addressService,
			fake.envelopeService,
		);

		const result = await service.syncBodies(
			["msg-1"],
			"acc-1",
			"acc-cfg-1",
			"INBOX",
			async () => buildFakeConnection(),
		);

		assert.equal(result.syncedCount, 0);
		assert.deepEqual(result.syncedMessageIds, []);
		assert.equal(result.failedCount, 1);
		assert.deepEqual(result.failedMessageIds, ["msg-1"]);
		assert.equal(fake.storedBodies.length, 1);
	});

	it("keeps earlier messages synced when a later message's parsed-cache write throws", async () => {
		// Per-message failure must not abort the whole batch: messages stored
		// before the failure stay synced; only the failing one requeues.
		const fakeOk = buildFakeState({ messageId: "msg-ok" });
		const fakeBad = buildFakeState({ messageId: "msg-bad" });
		const bodies = new Map<number, Buffer>([
			[101, A_RAW_EML],
			[102, A_RAW_EML],
		]);
		const messageService = {
			get: async (id: string) => ({
				messageId: id,
				mailboxId: "mbx-1",
				uid: id === "msg-ok" ? 101 : 102,
				messageIdHeader: "<abc@example.com>",
				bodyStorageKey: undefined,
			}),
			update: async () => ({}),
		} as unknown as MessageService;
		const failingForBad: StorageService = {
			...fakeOk.storageService,
			storeParsedBody: async (params) => {
				if (params.messageId === "msg-bad") {
					throw new Error("simulated S3 outage for msg-bad");
				}
				return fakeOk.storageService.storeParsedBody(params);
			},
		};
		const service = new BodySyncService(
			messageService,
			failingForBad,
			fakeBad.threadMessageService,
			fakeBad.addressService,
			fakeBad.envelopeService,
		);

		const result = await service.syncBodies(
			["msg-ok", "msg-bad"],
			"acc-1",
			"acc-cfg-1",
			"INBOX",
			async () => buildFakeConnection(undefined, { bodies }),
		);

		assert.deepEqual(result.syncedMessageIds, ["msg-ok"]);
		assert.deepEqual(result.failedMessageIds, ["msg-bad"]);
	});

	it("re-attempts the parsed-cache write on requeue after a first-pass failure", async () => {
		// Regression: storing bodyStorageKey BEFORE the parsed cache let the
		// requeued message hit the "already stored, skipping" guard, so the
		// parsed write that failed on pass 1 was never retried and the body
		// stayed unindexed. bodyStorageKey must only become durable once the
		// parsed cache is, so a requeue genuinely re-attempts and then indexes.
		const fake = buildFakeState({ messageId: "msg-1" });
		let parsedAttempts = 0;
		const flakyStorage: StorageService = {
			...fake.storageService,
			storeParsedBody: async (params) => {
				parsedAttempts++;
				if (parsedAttempts === 1) {
					throw new Error("simulated S3 outage on first pass");
				}
				return fake.storageService.storeParsedBody(params);
			},
		};
		const service = new BodySyncService(
			fake.messageService,
			flakyStorage,
			fake.threadMessageService,
			fake.addressService,
			fake.envelopeService,
		);

		const firstPass = await service.syncBodies(
			["msg-1"],
			"acc-1",
			"acc-cfg-1",
			"INBOX",
			async () => buildFakeConnection(),
		);

		assert.equal(firstPass.syncedCount, 0);
		assert.deepEqual(firstPass.failedMessageIds, ["msg-1"]);
		// The parsed cache failed, so nothing was persisted...
		assert.equal(fake.storedParsed.length, 0);

		const secondPass = await service.syncBodies(
			["msg-1"],
			"acc-1",
			"acc-cfg-1",
			"INBOX",
			async () => buildFakeConnection(),
		);

		// ...and the requeue RE-ATTEMPTS the parsed write rather than skipping,
		// so the message ends up synced and the parsed body is now stored.
		assert.equal(secondPass.skippedCount, 0);
		assert.equal(secondPass.syncedCount, 1);
		assert.deepEqual(secondPass.syncedMessageIds, ["msg-1"]);
		assert.equal(parsedAttempts, 2);
		assert.equal(fake.storedParsed.length, 1);
	});
});

describe("BodySyncService.syncBodies (classification + counters)", () => {
	it("persists Message.category and increments inbound counter on the From Address", async () => {
		const fake = buildFakeState({ messageId: "msg-1" });
		const service = new BodySyncService(
			fake.messageService,
			fake.storageService,
			fake.threadMessageService,
			fake.addressService,
			fake.envelopeService,
		);

		const before = Date.now();
		await service.syncBodies(
			["msg-1"],
			"acc-1",
			"acc-cfg-1",
			"INBOX",
			async () => buildFakeConnection(),
		);
		const after = Date.now();

		const categoryUpdate = fake.updatedKeys.find(
			(u) => u.category !== undefined,
		);
		assert.ok(categoryUpdate, "expected a Message.category update");
		assert.equal(categoryUpdate.category, MessageCategory.personal);

		assert.equal(fake.inboundIncrements.length, 1);
		const expectedAddressId = AddressService.generateAddressId(
			"acc-cfg-1",
			"a@example.com",
		);
		assert.equal(fake.inboundIncrements[0].addressId, expectedAddressId);
		assert.ok(fake.inboundIncrements[0].now >= before);
		assert.ok(fake.inboundIncrements[0].now <= after);
	});

	it("classifies a List-Id + List-Unsubscribe message as newsletter", async () => {
		const fake = buildFakeState({
			messageId: "msg-2",
			rawEml: NEWSLETTER_EML,
		});
		const service = new BodySyncService(
			fake.messageService,
			fake.storageService,
			fake.threadMessageService,
			fake.addressService,
			fake.envelopeService,
		);

		await service.syncBodies(
			["msg-2"],
			"acc-1",
			"acc-cfg-1",
			"INBOX",
			async () => buildFakeConnection(NEWSLETTER_EML),
		);

		const categoryUpdate = fake.updatedKeys.find(
			(u) => u.category !== undefined,
		);
		assert.ok(categoryUpdate, "expected a Message.category update");
		assert.equal(categoryUpdate.category, MessageCategory.newsletter);
	});

	it("persists authenticity with dkimMismatch=false when DKIM d= aligns with From domain", async () => {
		// (a) Aligned DKIM: sender signs with their own domain — not suspicious.
		const alignedEml = Buffer.from(
			[
				"From: alice@example.com",
				"To: bob@example.com",
				"Subject: hello",
				"Message-ID: <aligned-1@example.com>",
				"DKIM-Signature: v=1; a=rsa-sha256; d=example.com; s=sel; b=xxx",
				"Content-Type: text/plain",
				"",
				"body text",
				"",
			].join("\r\n"),
		);
		const fake = buildFakeState({
			messageId: "msg-aligned",
			rawEml: alignedEml,
		});
		const service = new BodySyncService(
			fake.messageService,
			fake.storageService,
			fake.threadMessageService,
			fake.addressService,
			fake.envelopeService,
		);

		await service.syncBodies(
			["msg-aligned"],
			"acc-1",
			"acc-cfg-1",
			"INBOX",
			async () => buildFakeConnection(alignedEml),
		);

		const authenticityUpdate = fake.updatedKeys.find(
			(u) => u.authenticity !== undefined,
		);
		assert.ok(authenticityUpdate, "expected an authenticity update");
		assert.equal(authenticityUpdate.authenticity?.fromDomain, "example.com");
		assert.equal(authenticityUpdate.authenticity?.dkimDomain, "example.com");
		assert.equal(authenticityUpdate.authenticity?.dkimMismatch, false);
	});

	it("persists authenticity with dkimMismatch=true when DKIM d= is unrelated to From domain", async () => {
		// (b) Misaligned DKIM: From claims substack.com but signed by an unrelated relay —
		// the relay domain (mg.example.net) shares no ancestor with substack.com.
		const dkimEml = Buffer.from(
			[
				"From: alice@substack.com",
				"To: bob@example.com",
				"Subject: newsletter",
				"Message-ID: <dkim-1@substack.com>",
				"DKIM-Signature: v=1; a=rsa-sha256; d=mg.example.net; s=sel; b=xxx",
				"Content-Type: text/plain",
				"",
				"body text",
				"",
			].join("\r\n"),
		);
		const fake = buildFakeState({ messageId: "msg-dkim", rawEml: dkimEml });
		const service = new BodySyncService(
			fake.messageService,
			fake.storageService,
			fake.threadMessageService,
			fake.addressService,
			fake.envelopeService,
		);

		await service.syncBodies(
			["msg-dkim"],
			"acc-1",
			"acc-cfg-1",
			"INBOX",
			async () => buildFakeConnection(dkimEml),
		);

		const authenticityUpdate = fake.updatedKeys.find(
			(u) => u.authenticity !== undefined,
		);
		assert.ok(authenticityUpdate, "expected an authenticity update");
		assert.equal(authenticityUpdate.authenticity?.fromDomain, "substack.com");
		assert.equal(authenticityUpdate.authenticity?.dkimDomain, "mg.example.net");
		assert.equal(authenticityUpdate.authenticity?.dkimMismatch, true);
	});

	it("does not persist authenticity when no DKIM-Signature header is present", async () => {
		const fake = buildFakeState({ messageId: "msg-nodkim" });
		const service = new BodySyncService(
			fake.messageService,
			fake.storageService,
			fake.threadMessageService,
			fake.addressService,
			fake.envelopeService,
		);

		await service.syncBodies(
			["msg-nodkim"],
			"acc-1",
			"acc-cfg-1",
			"INBOX",
			async () => buildFakeConnection(),
		);

		const authenticityUpdate = fake.updatedKeys.find(
			(u) => "authenticity" in u && u.authenticity !== undefined,
		);
		assert.equal(
			authenticityUpdate,
			undefined,
			"should not persist authenticity when no DKIM headers",
		);
	});
});

describe("BodySyncService.syncBodies (per-part S3 storage)", () => {
	// These cases assert the eager per-part write behavior. Deferral defaults
	// ON (cost savings), so force it OFF here to exercise the original eager
	// path; the deferral + lazy-generation behavior has its own block below.
	const previousDeferEnv = process.env.DEFER_BODY_PARTS;
	before(() => {
		process.env.DEFER_BODY_PARTS = "false";
	});
	after(() => {
		if (previousDeferEnv === undefined) {
			delete process.env.DEFER_BODY_PARTS;
		} else {
			process.env.DEFER_BODY_PARTS = previousDeferEnv;
		}
	});

	// multipart/mixed with html + a downloadable PDF attachment. The PDF
	// must end up at a per-part S3 key so the SPA can serve it via
	// CloudFront (BodyPartResponse.contentUrl). Inline image cases work
	// even without this PR because mailparser folds `cid:` images into
	// `data:` URIs by default — non-image attachments don't get that
	// treatment, which is the actual P0 surface.
	const ATTACHMENT_EML = ((): Buffer => {
		const pdfBytes = Buffer.from("%PDF-1.4\n");
		const pdfB64 = pdfBytes.toString("base64");
		return Buffer.from(
			[
				"From: alice@example.com",
				"To: bob@example.com",
				"Subject: with attachment",
				"Message-ID: <attach-1@example.com>",
				'Content-Type: multipart/mixed; boundary="mix"',
				"MIME-Version: 1.0",
				"",
				"--mix",
				"Content-Type: text/html; charset=utf-8",
				"Content-Transfer-Encoding: 7bit",
				"",
				"<html><body>resume attached</body></html>",
				"--mix",
				"Content-Type: application/pdf; name=alice-resume.pdf",
				"Content-Transfer-Encoding: base64",
				"Content-Disposition: attachment; filename=alice-resume.pdf",
				"",
				pdfB64,
				"--mix--",
				"",
			].join("\r\n"),
		);
	})();

	const attachmentBodyParts: BodyPartItem[] = [
		{
			bodyPartId: "bp-root",
			messageId: "msg-attach",
			partPath: "0",
			mediaType: "MULTIPART",
			mediaSubtype: "mixed",
			transferEncoding: "7BIT",
			sizeOctets: 0,
			isMultipart: true,
			multipartSubtype: "mixed",
			createdAt: 0,
			updatedAt: 0,
		} as BodyPartItem,
		{
			bodyPartId: "bp-html",
			messageId: "msg-attach",
			parentBodyPartId: "bp-root",
			partPath: "1",
			mediaType: "TEXT",
			mediaSubtype: "html",
			transferEncoding: "7BIT",
			sizeOctets: 40,
			isMultipart: false,
			createdAt: 0,
			updatedAt: 0,
		} as BodyPartItem,
		{
			bodyPartId: "bp-pdf",
			messageId: "msg-attach",
			parentBodyPartId: "bp-root",
			partPath: "2",
			mediaType: "APPLICATION",
			mediaSubtype: "pdf",
			transferEncoding: "BASE64",
			sizeOctets: 9,
			isMultipart: false,
			disposition: "attachment",
			dispositionFilename: "alice-resume.pdf",
			createdAt: 0,
			updatedAt: 0,
		} as BodyPartItem,
	];

	it("writes one S3 object per non-multipart leaf at accounts/{accountConfigId}/{accountId}/messages/{messageId}/parts/{partPath}", async () => {
		const fake = buildFakeState({
			messageId: "msg-attach",
			rawEml: ATTACHMENT_EML,
			bodyParts: attachmentBodyParts,
		});
		const service = new BodySyncService(
			fake.messageService,
			fake.storageService,
			fake.threadMessageService,
			fake.addressService,
			fake.envelopeService,
		);

		await service.syncBodies(
			["msg-attach"],
			"acc-1",
			"acc-cfg-1",
			"INBOX",
			async () => buildFakeConnection(ATTACHMENT_EML),
		);

		assert.equal(fake.storedBodyParts.length, 2);
		const byPath = new Map(fake.storedBodyParts.map((p) => [p.partPath, p]));

		const html = byPath.get("1");
		assert.ok(html, "html leaf at partPath=1 written");
		assert.equal(html.accountConfigId, "acc-cfg-1");
		assert.equal(html.accountId, "acc-1");
		assert.equal(html.messageId, "msg-attach");
		assert.equal(html.contentType, "text/html");
		assert.match(html.content.toString("utf8"), /resume attached/);

		const pdf = byPath.get("2");
		assert.ok(pdf, "pdf leaf at partPath=2 written");
		assert.equal(pdf.contentType, "application/pdf");
		// Decoded PDF bytes from mailparser, not base64 text.
		assert.equal(pdf.content.toString("utf8"), "%PDF-1.4\n");
	});

	it("does nothing when there are no BodyPart rows (legacy pre-#133 messages)", async () => {
		const fake = buildFakeState({ messageId: "msg-legacy" });
		const service = new BodySyncService(
			fake.messageService,
			fake.storageService,
			fake.threadMessageService,
			fake.addressService,
			fake.envelopeService,
		);

		await service.syncBodies(
			["msg-legacy"],
			"acc-1",
			"acc-cfg-1",
			"INBOX",
			async () => buildFakeConnection(),
		);

		assert.equal(fake.storedBodyParts.length, 0);
	});

	it("pairs every leaf — orphan inline-image leaf gets a zero-byte object, body-sync still succeeds", async () => {
		// One mappable PDF leaf + one orphan inline-image leaf. The mapper
		// is total (#395 PR B): the orphan still gets a pair, with a
		// zero-byte buffer when no source bytes are available. The S3 write
		// still fires so the URL shape resolves (to a zero-byte object).
		const mixedBodyParts: BodyPartItem[] = [
			{
				bodyPartId: "bp-root",
				messageId: "msg-mixed",
				partPath: "0",
				mediaType: "MULTIPART",
				mediaSubtype: "mixed",
				transferEncoding: "7BIT",
				sizeOctets: 0,
				isMultipart: true,
				multipartSubtype: "mixed",
				createdAt: 0,
				updatedAt: 0,
			} as BodyPartItem,
			{
				bodyPartId: "bp-html",
				messageId: "msg-mixed",
				parentBodyPartId: "bp-root",
				partPath: "1",
				mediaType: "TEXT",
				mediaSubtype: "html",
				transferEncoding: "7BIT",
				sizeOctets: 40,
				isMultipart: false,
				createdAt: 0,
				updatedAt: 0,
			} as BodyPartItem,
			{
				bodyPartId: "bp-pdf",
				messageId: "msg-mixed",
				parentBodyPartId: "bp-root",
				partPath: "2",
				mediaType: "APPLICATION",
				mediaSubtype: "pdf",
				transferEncoding: "BASE64",
				sizeOctets: 9,
				isMultipart: false,
				disposition: "attachment",
				dispositionFilename: "alice-resume.pdf",
				createdAt: 0,
				updatedAt: 0,
			} as BodyPartItem,
			{
				bodyPartId: "bp-orphan",
				messageId: "msg-mixed",
				parentBodyPartId: "bp-root",
				partPath: "3",
				mediaType: "IMAGE",
				mediaSubtype: "png",
				transferEncoding: "BASE64",
				sizeOctets: 1,
				isMultipart: false,
				disposition: "inline",
				contentId: "missing-cid@example.com",
				createdAt: 0,
				updatedAt: 0,
			} as BodyPartItem,
		];

		const fake = buildFakeState({
			messageId: "msg-mixed",
			rawEml: ATTACHMENT_EML,
			bodyParts: mixedBodyParts,
		});
		const service = new BodySyncService(
			fake.messageService,
			fake.storageService,
			fake.threadMessageService,
			fake.addressService,
			fake.envelopeService,
		);

		const result = await service.syncBodies(
			["msg-mixed"],
			"acc-1",
			"acc-cfg-1",
			"INBOX",
			async () => buildFakeConnection(ATTACHMENT_EML),
		);

		// Message is "synced" — we do NOT fail the whole body-sync over
		// one missing inline image.
		assert.equal(result.syncedCount, 1);
		assert.equal(result.failedCount, 0);
		// All three non-multipart leaves (html, pdf, orphan png) get S3
		// objects — totality means the orphan PNG lands as a zero-byte
		// object alongside the real ones.
		assert.equal(fake.storedBodyParts.length, 3);
		const paths = fake.storedBodyParts.map((p) => p.partPath).sort();
		assert.deepEqual(paths, ["1", "2", "3"]);
		const orphan = fake.storedBodyParts.find((p) => p.partPath === "3");
		assert.ok(orphan, "orphan inline-image leaf written");
		assert.equal(orphan.content.length, 0);
	});

	// The new application/octet-stream tolerance: BodyPart row was
	// `application/octet-stream` (IMAP BODYSTRUCTURE) but mailparser sniffed
	// `application/pdf` from the filename. The whole-message body-sync used
	// to throw here — now it succeeds and stores the PDF bytes under the
	// octet-stream contentType the row dictates.
	it("stores an octet-stream-labelled attachment when mailparser refines it to application/pdf (Odido bug)", async () => {
		const octetBodyParts: BodyPartItem[] = [
			{
				bodyPartId: "bp-root",
				messageId: "msg-odido",
				partPath: "0",
				mediaType: "MULTIPART",
				mediaSubtype: "mixed",
				transferEncoding: "7BIT",
				sizeOctets: 0,
				isMultipart: true,
				multipartSubtype: "mixed",
				createdAt: 0,
				updatedAt: 0,
			} as BodyPartItem,
			{
				bodyPartId: "bp-html",
				messageId: "msg-odido",
				parentBodyPartId: "bp-root",
				partPath: "1",
				mediaType: "TEXT",
				mediaSubtype: "html",
				transferEncoding: "7BIT",
				sizeOctets: 40,
				isMultipart: false,
				createdAt: 0,
				updatedAt: 0,
			} as BodyPartItem,
			{
				bodyPartId: "bp-octet",
				messageId: "msg-odido",
				parentBodyPartId: "bp-root",
				partPath: "2",
				// The bug: IMAP labels the PDF as octet-stream.
				mediaType: "APPLICATION",
				mediaSubtype: "octet-stream",
				transferEncoding: "BASE64",
				sizeOctets: 9,
				isMultipart: false,
				disposition: "attachment",
				dispositionFilename: "alice-resume.pdf",
				createdAt: 0,
				updatedAt: 0,
			} as BodyPartItem,
		];

		const fake = buildFakeState({
			messageId: "msg-odido",
			rawEml: ATTACHMENT_EML,
			bodyParts: octetBodyParts,
		});
		const service = new BodySyncService(
			fake.messageService,
			fake.storageService,
			fake.threadMessageService,
			fake.addressService,
			fake.envelopeService,
		);

		const result = await service.syncBodies(
			["msg-odido"],
			"acc-1",
			"acc-cfg-1",
			"INBOX",
			async () => buildFakeConnection(ATTACHMENT_EML),
		);

		assert.equal(result.syncedCount, 1);
		assert.equal(fake.storedBodyParts.length, 2);
		const byPath = new Map(fake.storedBodyParts.map((p) => [p.partPath, p]));
		const pdf = byPath.get("2");
		assert.ok(pdf, "octet-stream-labelled PDF leaf written");
		// The contentType comes from the BodyPart row, so the resulting
		// S3 object is stored as application/octet-stream — that's what
		// the SPA's contentUrl resolves to and matches the BodyPart entity
		// the API returns.
		assert.equal(pdf.contentType, "application/octet-stream");
		// Bytes are the decoded PDF from mailparser, not base64 text.
		assert.equal(pdf.content.toString("utf8"), "%PDF-1.4\n");
	});
});

describe("BodySyncService body-part deferral + lazy generation", () => {
	// multipart/mixed with an html part + a base64 PDF attachment. Same shape
	// the eager block uses, redeclared here so this block is self-contained.
	const DEFER_EML = ((): Buffer => {
		const pdfB64 = Buffer.from("%PDF-1.4\n").toString("base64");
		return Buffer.from(
			[
				"From: alice@example.com",
				"To: bob@example.com",
				"Subject: with attachment",
				"Message-ID: <defer-1@example.com>",
				'Content-Type: multipart/mixed; boundary="mix"',
				"MIME-Version: 1.0",
				"",
				"--mix",
				"Content-Type: text/html; charset=utf-8",
				"Content-Transfer-Encoding: 7bit",
				"",
				"<html><body>resume attached</body></html>",
				"--mix",
				"Content-Type: application/pdf; name=alice-resume.pdf",
				"Content-Transfer-Encoding: base64",
				"Content-Disposition: attachment; filename=alice-resume.pdf",
				"",
				pdfB64,
				"--mix--",
				"",
			].join("\r\n"),
		);
	})();

	const deferBodyParts: BodyPartItem[] = [
		{
			bodyPartId: "bp-root",
			messageId: "msg-defer",
			partPath: "0",
			mediaType: "MULTIPART",
			mediaSubtype: "mixed",
			transferEncoding: "7BIT",
			sizeOctets: 0,
			isMultipart: true,
			multipartSubtype: "mixed",
			createdAt: 0,
			updatedAt: 0,
		} as BodyPartItem,
		{
			bodyPartId: "bp-html",
			messageId: "msg-defer",
			parentBodyPartId: "bp-root",
			partPath: "1",
			mediaType: "TEXT",
			mediaSubtype: "html",
			transferEncoding: "7BIT",
			sizeOctets: 40,
			isMultipart: false,
			createdAt: 0,
			updatedAt: 0,
		} as BodyPartItem,
		{
			bodyPartId: "bp-pdf",
			messageId: "msg-defer",
			parentBodyPartId: "bp-root",
			partPath: "2",
			mediaType: "APPLICATION",
			mediaSubtype: "pdf",
			transferEncoding: "BASE64",
			sizeOctets: 9,
			isMultipart: false,
			disposition: "attachment",
			dispositionFilename: "alice-resume.pdf",
			createdAt: 0,
			updatedAt: 0,
		} as BodyPartItem,
	];

	const previousDeferEnv = process.env.DEFER_BODY_PARTS;
	before(() => {
		process.env.DEFER_BODY_PARTS = "true";
	});
	after(() => {
		if (previousDeferEnv === undefined) {
			delete process.env.DEFER_BODY_PARTS;
		} else {
			process.env.DEFER_BODY_PARTS = previousDeferEnv;
		}
	});

	it("deferred sync writes only body.eml + parsed.json.gz (2 storage writes, zero per-part objects)", async () => {
		const fake = buildFakeState({
			messageId: "msg-defer",
			rawEml: DEFER_EML,
			bodyParts: deferBodyParts,
		});
		const service = new BodySyncService(
			fake.messageService,
			fake.storageService,
			fake.threadMessageService,
			fake.addressService,
			fake.envelopeService,
		);

		await service.syncBodies(
			["msg-defer"],
			"acc-1",
			"acc-cfg-1",
			"INBOX",
			async () => buildFakeConnection(DEFER_EML),
		);

		// Exactly the two durable storage writes per message: the raw .eml and
		// the parsed-body cache. No per-part PutObjects.
		assert.equal(fake.storedBodies.length, 1, "one body.eml write");
		assert.equal(fake.storedParsed.length, 1, "one parsed.json.gz write");
		assert.equal(
			fake.storedBodyParts.length,
			0,
			"no per-part objects in deferred mode",
		);
	});

	it("ensureBodyPartsStored lazily generates the correct part bytes from stored body.eml", async () => {
		const fake = buildFakeState({
			messageId: "msg-defer",
			hasBodyStorageKey: true,
			rawEml: DEFER_EML,
			bodyParts: deferBodyParts,
		});
		const service = new BodySyncService(
			fake.messageService,
			fake.storageService,
			fake.threadMessageService,
			fake.addressService,
			fake.envelopeService,
		);

		const result = await service.ensureBodyPartsStored(
			"acc-cfg-1",
			"acc-1",
			"msg-defer",
			"s3://bucket/accounts/acc-cfg-1/acc-1/messages/msg-defer/body.eml",
		);

		assert.equal(result.stored, 2);
		const byPath = new Map(fake.storedBodyParts.map((p) => [p.partPath, p]));

		const html = byPath.get("1");
		assert.ok(html, "html leaf generated");
		assert.equal(html.contentType, "text/html");
		assert.match(html.content.toString("utf8"), /resume attached/);

		const pdf = byPath.get("2");
		assert.ok(pdf, "pdf leaf generated");
		assert.equal(pdf.contentType, "application/pdf");
		assert.equal(pdf.content.toString("utf8"), "%PDF-1.4\n");
	});

	it("ensureBodyPartsStored is idempotent — a second call writes nothing", async () => {
		const fake = buildFakeState({
			messageId: "msg-defer",
			hasBodyStorageKey: true,
			rawEml: DEFER_EML,
			bodyParts: deferBodyParts,
		});
		const service = new BodySyncService(
			fake.messageService,
			fake.storageService,
			fake.threadMessageService,
			fake.addressService,
			fake.envelopeService,
		);

		const key =
			"s3://bucket/accounts/acc-cfg-1/acc-1/messages/msg-defer/body.eml";

		const first = await service.ensureBodyPartsStored(
			"acc-cfg-1",
			"acc-1",
			"msg-defer",
			key,
		);
		assert.equal(first.stored, 2);
		// 2 real leaves + the .materialized sentinel.
		assert.equal(fake.storedBodyParts.length, 3);
		assert.ok(
			fake.storedBodyParts.some((p) => p.partPath === ".materialized"),
			"sentinel written after full materialization",
		);

		const second = await service.ensureBodyPartsStored(
			"acc-cfg-1",
			"acc-1",
			"msg-defer",
			key,
		);
		assert.equal(second.stored, 0, "no re-writes on second call");
		assert.equal(
			fake.storedBodyParts.length,
			3,
			"no duplicate per-part objects",
		);
	});

	it("warm open with sentinel present does zero GET / parse / per-part HEAD work", async () => {
		const fake = buildFakeState({
			messageId: "msg-defer",
			hasBodyStorageKey: true,
			rawEml: DEFER_EML,
			bodyParts: deferBodyParts,
		});
		const service = new BodySyncService(
			fake.messageService,
			fake.storageService,
			fake.threadMessageService,
			fake.addressService,
			fake.envelopeService,
		);

		const key =
			"s3://bucket/accounts/acc-cfg-1/acc-1/messages/msg-defer/body.eml";

		// Cold open: materializes parts + writes the sentinel.
		await service.ensureBodyPartsStored("acc-cfg-1", "acc-1", "msg-defer", key);

		// Reset counters so the warm open is measured in isolation.
		fake.counts.retrieve = 0;
		fake.counts.bodyPartExists = 0;
		fake.counts.listBodyParts = 0;

		const warm = await service.ensureBodyPartsStored(
			"acc-cfg-1",
			"acc-1",
			"msg-defer",
			key,
		);

		assert.equal(warm.stored, 0);
		// Exactly one HEAD — the sentinel check — and nothing else.
		assert.equal(fake.counts.bodyPartExists, 1, "one sentinel HEAD only");
		assert.equal(fake.counts.retrieve, 0, "no body.eml GET on warm open");
		assert.equal(fake.counts.listBodyParts, 0, "no MIME walk on warm open");
	});
});

describe("BodySyncService.syncBodies (junk rescue isolation)", () => {
	// Rescue predicate (shouldRescueFromJunk) passes only for a message that
	// sits in Junk, is not yet movedByRemit, was provider-classified as spam,
	// passed DMARC, and comes from a trusted (Vip/Wellknown) sender.
	const rescueableMessageOverrides = {
		mailboxId: "junk-mbx",
		movedByRemit: false,
		providerSpam: { classified: true },
		authResult: { dmarc: "Pass" },
	};

	const buildRescueConfig = (opts: {
		moveCalls: string[];
		moveImpl?: (messageId: string) => Promise<void>;
	}) => {
		const mailboxSpecialUseService = {
			findBySpecialUse: async (
				_accountId: string,
				specialUse: (typeof MailboxSpecialUse)[keyof typeof MailboxSpecialUse],
			) => {
				if (specialUse === MailboxSpecialUse.Junk) {
					return { mailboxId: "junk-mbx", fullPath: "Junk" };
				}
				return null;
			},
			findInboxMailbox: async () => ({
				mailboxId: "inbox-mbx",
				fullPath: "INBOX",
			}),
		} as unknown as MailboxSpecialUseService;

		const messageMoveService = {
			moveMessage:
				opts.moveImpl ??
				(async (_accountConfigId: string, messageId: string) => {
					opts.moveCalls.push(messageId);
				}),
		} as unknown as MessageMoveService;

		return {
			mailboxSpecialUseService,
			messageMoveService,
		};
	};

	const buildAddressServiceWithTrust = (
		_fake: ReturnType<typeof buildFakeState>,
		trust: (typeof SenderTrust)[keyof typeof SenderTrust],
	): AddressService =>
		({
			incrementInboundCount: async () => {},
			getAddress: async () => ({
				flags: {
					vip: { value: trust === SenderTrust.Vip },
					wellknown: { value: trust === SenderTrust.Wellknown },
				},
			}),
		}) as unknown as AddressService;

	const captureLogger = (): {
		logger: BodySyncLogger;
		warnings: Array<{ obj: Record<string, unknown>; msg: string }>;
		infos: Array<{ obj: Record<string, unknown>; msg: string }>;
	} => {
		const warnings: Array<{ obj: Record<string, unknown>; msg: string }> = [];
		const infos: Array<{ obj: Record<string, unknown>; msg: string }> = [];
		const logger: BodySyncLogger = {
			info: (obj, msg) => {
				infos.push({ obj, msg });
			},
			debug: () => {},
			warn: (obj, msg) => {
				warnings.push({ obj, msg });
			},
			error: () => {},
		};
		return { logger, warnings, infos };
	};

	it("rescues a trusted-sender message out of Junk on the happy path", async () => {
		const fake = buildFakeState({
			messageId: "msg-rescue",
			messageOverrides: rescueableMessageOverrides,
		});
		const moveCalls: string[] = [];
		const addressService = buildAddressServiceWithTrust(fake, SenderTrust.Vip);
		const service = new BodySyncService(
			fake.messageService,
			fake.storageService,
			fake.threadMessageService,
			addressService,
			fake.envelopeService,
			undefined,
			buildRescueConfig({ moveCalls }),
		);

		const result = await service.syncBodies(
			["msg-rescue"],
			"acc-1",
			"acc-cfg-1",
			"Junk",
			async () => buildFakeConnection(),
		);

		assert.equal(result.syncedCount, 1);
		assert.deepEqual(moveCalls, ["msg-rescue"]);
		const movedFlag = fake.updatedKeys.find((u) => u.movedByRemit === true);
		assert.ok(movedFlag, "expected movedByRemit=true update");
	});

	it("does NOT fail body-sync when the rescue throws — body cache still stored and message stays synced", async () => {
		const fake = buildFakeState({
			messageId: "msg-rescue-throw",
			messageOverrides: rescueableMessageOverrides,
		});
		const addressService = buildAddressServiceWithTrust(fake, SenderTrust.Vip);
		const { logger, warnings } = captureLogger();
		const service = new BodySyncService(
			fake.messageService,
			fake.storageService,
			fake.threadMessageService,
			addressService,
			fake.envelopeService,
			logger,
			buildRescueConfig({
				moveCalls: [],
				moveImpl: async () => {
					throw new Error("simulated moveMessage outage");
				},
			}),
		);

		const result = await service.syncBodies(
			["msg-rescue-throw"],
			"acc-1",
			"acc-cfg-1",
			"Junk",
			async () => buildFakeConnection(),
		);

		// The message still syncs — so the handler enqueues a search-index
		// upsert for it (syncedMessageIds drives that enqueue) and the inbox
		// populates regardless of the rescue blowing up.
		assert.equal(result.syncedCount, 1);
		assert.equal(result.failedCount, 0);
		assert.deepEqual(result.syncedMessageIds, ["msg-rescue-throw"]);
		// Critical-path side effects completed despite the rescue throwing.
		assert.equal(fake.storedBodies.length, 1, "body.eml stored");
		assert.equal(fake.storedParsed.length, 1, "parsed-body cache stored");
		// The failure was swallowed and logged, not propagated.
		assert.ok(
			warnings.some((w) => w.msg.includes("Placement move failed")),
			"expected a best-effort placement-move failure warning",
		);
	});

	it("runs the rescue AFTER the parsed-body cache is stored", async () => {
		const order: string[] = [];
		const fake = buildFakeState({
			messageId: "msg-order",
			messageOverrides: rescueableMessageOverrides,
		});
		const orderedStorage: StorageService = {
			...fake.storageService,
			storeParsedBody: async (params) => {
				order.push("storeParsedBody");
				return fake.storageService.storeParsedBody(params);
			},
		};
		const addressService = buildAddressServiceWithTrust(fake, SenderTrust.Vip);
		const service = new BodySyncService(
			fake.messageService,
			orderedStorage,
			fake.threadMessageService,
			addressService,
			fake.envelopeService,
			undefined,
			buildRescueConfig({
				moveCalls: [],
				moveImpl: async () => {
					order.push("rescueMove");
				},
			}),
		);

		await service.syncBodies(
			["msg-order"],
			"acc-1",
			"acc-cfg-1",
			"Junk",
			async () => buildFakeConnection(),
		);

		const cacheIdx = order.indexOf("storeParsedBody");
		const rescueIdx = order.indexOf("rescueMove");
		assert.ok(cacheIdx >= 0, "parsed-body cache was stored");
		assert.ok(rescueIdx >= 0, "rescue move ran");
		assert.ok(
			cacheIdx < rescueIdx,
			"parsed-body cache must be stored before the rescue moves the message",
		);
	});

	// A message sitting in INBOX whose DKIM signing domain does not align with
	// the From domain AND whose provider DMARC verdict is Fail — the confident
	// demote case (inbox → junk, HIGH bar) from an untrusted sender.
	const DEMOTE_EML = Buffer.from(
		[
			"From: ceo@yourbank.com",
			"To: victim@example.com",
			"Subject: urgent wire transfer",
			"Message-ID: <phish-1@yourbank.com>",
			"Authentication-Results: mx.example.com; dmarc=fail; spf=fail",
			// classifyPlacement's first guard needs BOTH providerSpam and authResult
			// present (the field, not a spam verdict) before it considers a verdict.
			"X-Spam-Status: No, score=0.0",
			"DKIM-Signature: v=1; a=rsa-sha256; d=evil-relay.net; s=sel; b=xxx",
			"Content-Type: text/plain",
			"",
			"please wire funds now",
			"",
		].join("\r\n"),
	);

	const buildPlacementConfig = (opts: {
		moveCalls: string[];
		junkMailboxId?: string;
		inboxMailboxId?: string;
	}) => {
		const junkMailboxId = opts.junkMailboxId ?? "junk-mbx";
		const inboxMailboxId = opts.inboxMailboxId ?? "inbox-mbx";
		const mailboxSpecialUseService = {
			findBySpecialUse: async (
				_accountId: string,
				specialUse: (typeof MailboxSpecialUse)[keyof typeof MailboxSpecialUse],
			) =>
				specialUse === MailboxSpecialUse.Junk
					? { mailboxId: junkMailboxId, fullPath: "Junk" }
					: null,
			findInboxMailbox: async () => ({
				mailboxId: inboxMailboxId,
				fullPath: "INBOX",
			}),
		} as unknown as MailboxSpecialUseService;

		const messageMoveService = {
			moveMessage: async (
				_accountConfigId: string,
				messageId: string,
				destinationMailboxId: string,
			) => {
				opts.moveCalls.push(`${messageId}->${destinationMailboxId}`);
			},
		} as unknown as MessageMoveService;

		return {
			mailboxSpecialUseService,
			messageMoveService,
		};
	};

	// An untrusted sender: deriveSenderTrust resolves to Unknown via a clean
	// NotFoundError (a genuinely-absent Address), not by a missing-method throw —
	// so the placement path runs the real verdict instead of aborting in its catch.
	const untrustedAddressService = {
		incrementInboundCount: async () => {},
		getAddress: async () => {
			throw new NotFoundError("Address not found");
		},
	} as unknown as AddressService;

	it("demotes an untrusted inbox phish (dkimMismatch + dmarc=Fail) into Junk", async () => {
		const fake = buildFakeState({
			messageId: "msg-demote",
			rawEml: DEMOTE_EML,
			messageOverrides: { mailboxId: "inbox-mbx", movedByRemit: false },
		});
		const moveCalls: string[] = [];
		const service = new BodySyncService(
			fake.messageService,
			fake.storageService,
			fake.threadMessageService,
			untrustedAddressService,
			fake.envelopeService,
			undefined,
			buildPlacementConfig({ moveCalls }),
		);

		const result = await service.syncBodies(
			["msg-demote"],
			"acc-1",
			"acc-cfg-1",
			"INBOX",
			async () => buildFakeConnection(DEMOTE_EML),
		);

		assert.equal(result.syncedCount, 1);
		assert.deepEqual(moveCalls, ["msg-demote->junk-mbx"]);
		const movedFlag = fake.updatedKeys.find((u) => u.movedByRemit === true);
		assert.ok(movedFlag, "expected movedByRemit=true update for the demote");
	});

	it("leaves a DMARC-pass dkim-mismatch inbox message in place (unsure → no move, no flag)", async () => {
		// dkimMismatch but DMARC did NOT fail — deferred to a later LLM tier, must
		// never auto-demote.
		const dmarcPassEml = Buffer.from(
			[
				"From: ceo@yourbank.com",
				"To: victim@example.com",
				"Subject: newsletter",
				"Message-ID: <maybe-1@yourbank.com>",
				"Authentication-Results: mx.example.com; dmarc=pass",
				"X-Spam-Status: No, score=0.0",
				"DKIM-Signature: v=1; a=rsa-sha256; d=mailer.net; s=sel; b=xxx",
				"Content-Type: text/plain",
				"",
				"body",
				"",
			].join("\r\n"),
		);
		const fake = buildFakeState({
			messageId: "msg-defer",
			rawEml: dmarcPassEml,
			messageOverrides: { mailboxId: "inbox-mbx", movedByRemit: false },
		});
		const moveCalls: string[] = [];
		const service = new BodySyncService(
			fake.messageService,
			fake.storageService,
			fake.threadMessageService,
			untrustedAddressService,
			fake.envelopeService,
			undefined,
			buildPlacementConfig({ moveCalls }),
		);

		const result = await service.syncBodies(
			["msg-defer"],
			"acc-1",
			"acc-cfg-1",
			"INBOX",
			async () => buildFakeConnection(dmarcPassEml),
		);

		assert.equal(result.syncedCount, 1);
		assert.deepEqual(moveCalls, [], "no move for an unsure verdict");
		assert.equal(
			fake.updatedKeys.find((u) => u.movedByRemit === true),
			undefined,
			"no movedByRemit flag for an unsure verdict",
		);
	});

	it("leaves an untrusted junk message in place (anti-spoof guard: rescue needs trust)", async () => {
		// Provider=spam + dmarc=Pass in Junk, but the sender is untrusted —
		// classifyPlacement returns unsure, so no rescue fires.
		const junkSpamEml = Buffer.from(
			[
				"From: deals@faddedsms.com",
				"To: bob@example.com",
				"Subject: cheap deals",
				"Message-ID: <spam-1@faddedsms.com>",
				"Authentication-Results: mx.example.com; dmarc=pass",
				"X-SpamExperts-Class: Spam",
				"Content-Type: text/plain",
				"",
				"buy now",
				"",
			].join("\r\n"),
		);
		const fake = buildFakeState({
			messageId: "msg-untrusted-junk",
			rawEml: junkSpamEml,
			messageOverrides: { mailboxId: "junk-mbx", movedByRemit: false },
		});
		const moveCalls: string[] = [];
		const service = new BodySyncService(
			fake.messageService,
			fake.storageService,
			fake.threadMessageService,
			untrustedAddressService,
			fake.envelopeService,
			undefined,
			buildPlacementConfig({ moveCalls }),
		);

		const result = await service.syncBodies(
			["msg-untrusted-junk"],
			"acc-1",
			"acc-cfg-1",
			"Junk",
			async () => buildFakeConnection(junkSpamEml),
		);

		assert.equal(result.syncedCount, 1);
		assert.deepEqual(moveCalls, [], "untrusted junk is not auto-rescued");
		assert.equal(
			fake.updatedKeys.find((u) => u.movedByRemit === true),
			undefined,
			"no movedByRemit flag for an untrusted-junk no-op",
		);
	});

	it("persists the placementVerdict audit record on a confident LIVE move (dryRun:false)", async () => {
		const fake = buildFakeState({
			messageId: "msg-audit-live",
			rawEml: DEMOTE_EML,
			messageOverrides: { mailboxId: "inbox-mbx", movedByRemit: false },
		});
		const moveCalls: string[] = [];
		const service = new BodySyncService(
			fake.messageService,
			fake.storageService,
			fake.threadMessageService,
			untrustedAddressService,
			fake.envelopeService,
			undefined,
			buildPlacementConfig({ moveCalls }),
		);

		const result = await service.syncBodies(
			["msg-audit-live"],
			"acc-1",
			"acc-cfg-1",
			"INBOX",
			async () => buildFakeConnection(DEMOTE_EML),
		);

		assert.equal(result.syncedCount, 1);

		// Exactly one Message update for this message — the audit verdict and the
		// move flag ride the SAME UpdateItem, not a second write.
		const updates = fake.updatedKeys.filter(
			(u) => u.messageId === "msg-audit-live",
		);
		assert.equal(updates.length, 1, "exactly one Message update");

		const update = updates[0];
		assert.ok(update?.placementVerdict, "placementVerdict folded into update");
		assert.equal(update?.movedByRemit, true, "movedByRemit set on a live move");
		assert.equal(update?.placementVerdict?.action, PlacementAction.MoveToJunk);
		assert.equal(
			update?.placementVerdict?.confidence,
			PlacementConfidence.Confident,
		);
		assert.equal(update?.placementVerdict?.fromPlacement, "inbox");
		assert.equal(update?.placementVerdict?.dryRun, false);
		assert.deepEqual(update?.placementVerdict?.reasons, [
			"dkim-mismatch",
			"dmarc=fail",
			"sender=untrusted",
		]);
		assert.equal(typeof update?.placementVerdict?.decidedAt, "number");
		assert.deepEqual(moveCalls, ["msg-audit-live->junk-mbx"]);
	});

	it("records NO placementVerdict for an unsure (deferred) verdict — left in place, no move, no flag", async () => {
		// dkimMismatch but DMARC=pass: classifyPlacement returns an unsure `leave`
		// verdict, so nothing is recorded on the message.
		const dmarcPassEml = Buffer.from(
			[
				"From: ceo@yourbank.com",
				"To: victim@example.com",
				"Subject: newsletter",
				"Message-ID: <maybe-2@yourbank.com>",
				"Authentication-Results: mx.example.com; dmarc=pass",
				"X-Spam-Status: No, score=0.0",
				"DKIM-Signature: v=1; a=rsa-sha256; d=mailer.net; s=sel; b=xxx",
				"Content-Type: text/plain",
				"",
				"body",
				"",
			].join("\r\n"),
		);
		const fake = buildFakeState({
			messageId: "msg-audit-unsure",
			rawEml: dmarcPassEml,
			messageOverrides: { mailboxId: "inbox-mbx", movedByRemit: false },
		});
		const moveCalls: string[] = [];
		const service = new BodySyncService(
			fake.messageService,
			fake.storageService,
			fake.threadMessageService,
			untrustedAddressService,
			fake.envelopeService,
			undefined,
			buildPlacementConfig({ moveCalls }),
		);

		const result = await service.syncBodies(
			["msg-audit-unsure"],
			"acc-1",
			"acc-cfg-1",
			"INBOX",
			async () => buildFakeConnection(dmarcPassEml),
		);

		assert.equal(result.syncedCount, 1);
		assert.deepEqual(moveCalls, [], "no move for an unsure verdict");

		const updates = fake.updatedKeys.filter(
			(u) => u.messageId === "msg-audit-unsure",
		);
		assert.equal(updates.length, 1, "exactly one Message update");
		assert.equal(
			updates[0]?.placementVerdict,
			undefined,
			"no audit record for an unsure leave",
		);
		assert.equal(
			updates[0]?.movedByRemit,
			undefined,
			"no movedByRemit flag for an unsure leave",
		);
	});

	it("records NO placementVerdict for a confident `leave` verdict (already moved by Remit)", async () => {
		// movedByRemit=true short-circuits classifyPlacement to a confident `leave`.
		const fake = buildFakeState({
			messageId: "msg-audit-leave",
			rawEml: DEMOTE_EML,
			messageOverrides: { mailboxId: "inbox-mbx", movedByRemit: true },
		});
		const moveCalls: string[] = [];
		const service = new BodySyncService(
			fake.messageService,
			fake.storageService,
			fake.threadMessageService,
			untrustedAddressService,
			fake.envelopeService,
			undefined,
			buildPlacementConfig({ moveCalls }),
		);

		const result = await service.syncBodies(
			["msg-audit-leave"],
			"acc-1",
			"acc-cfg-1",
			"INBOX",
			async () => buildFakeConnection(DEMOTE_EML),
		);

		assert.equal(result.syncedCount, 1);
		assert.deepEqual(moveCalls, [], "a leave verdict moves nothing");

		const updates = fake.updatedKeys.filter(
			(u) => u.messageId === "msg-audit-leave",
		);
		assert.equal(updates.length, 1, "exactly one Message update");
		assert.equal(
			updates[0]?.placementVerdict,
			undefined,
			"no audit record for a leave verdict",
		);
	});

	it("does NOT fail body-sync when placement computation throws — body stored, message stays synced, alert logged", async () => {
		// Simulates a placement-repo query error (e.g. a schema-drifted DB missing
		// a table): the mailboxSpecialUseService itself throws, not the move.
		const fake = buildFakeState({
			messageId: "msg-placement-throw",
			messageOverrides: rescueableMessageOverrides,
		});
		const addressService = buildAddressServiceWithTrust(fake, SenderTrust.Vip);
		const errors: Array<{ obj: Record<string, unknown>; msg: string }> = [];
		const logger: BodySyncLogger = {
			info: () => {},
			debug: () => {},
			warn: () => {},
			error: (obj, msg) => {
				errors.push({ obj, msg });
			},
		};
		const failingMailboxSpecialUseService = {
			findBySpecialUse: async () => {
				throw new Error('relation "mailbox_special_use_entry" does not exist');
			},
			findInboxMailbox: async () => ({
				mailboxId: "inbox-mbx",
				fullPath: "INBOX",
			}),
		} as unknown as MailboxSpecialUseService;
		const moveCalls: string[] = [];
		const messageMoveService = {
			moveMessage: async (_accountConfigId: string, messageId: string) => {
				moveCalls.push(messageId);
			},
		} as unknown as MessageMoveService;

		const service = new BodySyncService(
			fake.messageService,
			fake.storageService,
			fake.threadMessageService,
			addressService,
			fake.envelopeService,
			logger,
			{
				mailboxSpecialUseService: failingMailboxSpecialUseService,
				messageMoveService,
			},
		);

		const result = await service.syncBodies(
			["msg-placement-throw"],
			"acc-1",
			"acc-cfg-1",
			"Junk",
			async () => buildFakeConnection(),
		);

		// The message still syncs — placement is auxiliary, the body was already
		// durably written before placement ran.
		assert.equal(result.syncedCount, 1);
		assert.equal(result.failedCount, 0);
		assert.deepEqual(result.syncedMessageIds, ["msg-placement-throw"]);
		assert.equal(fake.storedBodies.length, 1, "body.eml stored");
		assert.equal(fake.storedParsed.length, 1, "parsed-body cache stored");

		// No move was attempted and no audit verdict recorded — placement failed
		// outright, it did not decide anything.
		assert.deepEqual(moveCalls, [], "no move attempted when placement throws");
		const updates = fake.updatedKeys.filter(
			(u) => u.messageId === "msg-placement-throw",
		);
		assert.equal(updates.length, 1, "exactly one Message update");
		assert.equal(
			updates[0]?.placementVerdict,
			undefined,
			"no audit record when placement computation throws",
		);
		assert.equal(
			updates[0]?.movedByRemit,
			undefined,
			"no movedByRemit flag when placement computation throws",
		);

		// Loud, structured, alert-style log — this is the point, not a silent
		// swallow.
		const alertLog = errors.find(
			(e) => e.obj.alert === "body_sync_placement_failed",
		);
		assert.ok(alertLog, "expected an alert-tagged placement-failure log");
		assert.equal(alertLog?.obj.messageId, "msg-placement-throw");
		assert.equal(alertLog?.obj.accountId, "acc-1");
		assert.ok(alertLog?.obj.error, "error detail included in the log");
	});

	it("still records the placementVerdict and enqueues the move when placement computation succeeds", async () => {
		// Placement success is unaffected by the isolation wrapper — the confident
		// demote path still writes the audit verdict and enqueues the move.
		const fake = buildFakeState({
			messageId: "msg-placement-ok",
			rawEml: DEMOTE_EML,
			messageOverrides: { mailboxId: "inbox-mbx", movedByRemit: false },
		});
		const moveCalls: string[] = [];
		const service = new BodySyncService(
			fake.messageService,
			fake.storageService,
			fake.threadMessageService,
			untrustedAddressService,
			fake.envelopeService,
			undefined,
			buildPlacementConfig({ moveCalls }),
		);

		const result = await service.syncBodies(
			["msg-placement-ok"],
			"acc-1",
			"acc-cfg-1",
			"INBOX",
			async () => buildFakeConnection(DEMOTE_EML),
		);

		assert.equal(result.syncedCount, 1);
		assert.deepEqual(moveCalls, ["msg-placement-ok->junk-mbx"]);
		const updates = fake.updatedKeys.filter(
			(u) => u.messageId === "msg-placement-ok",
		);
		assert.equal(updates.length, 1, "exactly one Message update");
		assert.ok(
			updates[0]?.placementVerdict,
			"placementVerdict folded into update on success",
		);
		assert.equal(updates[0]?.movedByRemit, true);
	});
});

describe("BodySyncService.syncBodies (pipelined ranged fetch)", () => {
	const rawForUid = (uid: number): Buffer =>
		Buffer.from(
			[
				"From: a@example.com",
				"To: b@example.com",
				`Subject: msg ${uid}`,
				`Message-ID: <${uid}@example.com>`,
				"Content-Type: text/plain",
				"",
				`body ${uid}`,
				"",
			].join("\r\n"),
		);

	// Multi-message fake: each messageId maps to a distinct uid and .eml, so we
	// can assert the whole batch goes out in ONE ranged FETCH.
	const buildMultiState = (
		entries: Array<{ messageId: string; uid: number; alreadyStored?: boolean }>,
	) => {
		const storedStreamIds: string[] = [];
		const messages = new Map(
			entries.map((e) => [
				e.messageId,
				{
					messageId: e.messageId,
					mailboxId: "mbx-1",
					uid: e.uid,
					messageIdHeader: `<${e.uid}@example.com>`,
					bodyStorageKey: e.alreadyStored
						? `s3://bucket/${e.messageId}/body.eml`
						: (undefined as string | undefined),
				},
			]),
		);

		const messageService = {
			get: async (id: string) => {
				const m = messages.get(id);
				if (!m) throw new Error(`unknown message ${id}`);
				return m;
			},
			update: async (id: string, input: UpdateMessageInput) => {
				const m = messages.get(id);
				if (m && input.bodyStorageKey) m.bodyStorageKey = input.bodyStorageKey;
				return m;
			},
		} as unknown as MessageService;

		const storageService = {
			...buildFakeState({ messageId: entries[0].messageId }).storageService,
			storeMessageBodyStream: async (params: {
				accountConfigId: string;
				accountId: string;
				messageId: string;
				content: Readable;
			}): Promise<StorageReference> => {
				// Drain the stream — proves the body is consumed as a stream, not a
				// pre-built whole-body buffer handed to storeMessageBody.
				for await (const _chunk of params.content) {
					// consume
				}
				storedStreamIds.push(params.messageId);
				return {
					uri: `s3://bucket/${params.messageId}/body.eml`,
					storageType: "s3",
					storageLocation: "bucket",
					storageKey: `${params.messageId}/body.eml`,
					sizeBytes: 1,
					checksumSha256: "x",
					contentEncoding: "gzip",
				};
			},
		} as unknown as StorageService;

		const addressService = {
			incrementInboundCount: async () => {},
		} as unknown as AddressService;
		const threadMessageService = {
			getByMessageId: async (_accountConfigId: string, id: string) => ({
				threadMessageId: `tm-${id}`,
				messageId: id,
			}),
			update: async () => ({}),
		} as unknown as ThreadMessageService;
		const envelopeService = {
			listBodyParts: async () => [],
		} as unknown as EnvelopeService;

		const bodies = new Map(entries.map((e) => [e.uid, rawForUid(e.uid)]));

		return {
			messageService,
			storageService,
			addressService,
			threadMessageService,
			envelopeService,
			bodies,
			storedStreamIds,
		};
	};

	it("issues ONE SELECT and ONE ranged FETCH for the whole batch", async () => {
		const entries = [
			{ messageId: "m-1", uid: 11 },
			{ messageId: "m-2", uid: 12 },
			{ messageId: "m-3", uid: 13 },
		];
		const fake = buildMultiState(entries);
		const calls: FakeConnectionCalls = {
			openBoxCount: 0,
			fetchBatchCount: 0,
			fetchedUidBatches: [],
		};
		const service = new BodySyncService(
			fake.messageService,
			fake.storageService,
			fake.threadMessageService,
			fake.addressService,
			fake.envelopeService,
		);

		const result = await service.syncBodies(
			entries.map((e) => e.messageId),
			"acc-1",
			"acc-cfg-1",
			"INBOX",
			async () =>
				buildFakeConnection(undefined, { bodies: fake.bodies, calls }),
		);

		assert.equal(result.syncedCount, 3);
		assert.equal(calls.openBoxCount, 1, "exactly one SELECT for the batch");
		assert.equal(calls.fetchBatchCount, 1, "exactly one ranged FETCH");
		assert.deepEqual(
			calls.fetchedUidBatches,
			[[11, 12, 13]],
			"all UIDs go out in a single ranged FETCH",
		);
		// Bodies were streamed, not buffered+stored via storeMessageBody.
		assert.deepEqual(fake.storedStreamIds.sort(), ["m-1", "m-2", "m-3"]);
	});

	it("re-enqueues UIDs not yet yielded when the stream drops mid-batch (typed MailConnectionError)", async () => {
		const entries = [
			{ messageId: "m-1", uid: 11 },
			{ messageId: "m-2", uid: 12 },
			{ messageId: "m-3", uid: 13 },
		];
		const fake = buildMultiState(entries);
		const service = new BodySyncService(
			fake.messageService,
			fake.storageService,
			fake.threadMessageService,
			fake.addressService,
			fake.envelopeService,
		);

		const result = await service.syncBodies(
			entries.map((e) => e.messageId),
			"acc-1",
			"acc-cfg-1",
			"INBOX",
			// Drop after the first message is yielded, with the exact typed error
			// `fetchMessageBodies` rethrows on a real disconnect.
			async () =>
				buildFakeConnection(undefined, { bodies: fake.bodies, dropAfter: 1 }),
		);

		assert.equal(result.syncedCount, 1);
		assert.deepEqual(result.syncedMessageIds, ["m-1"]);
		// m-2 and m-3 were never yielded — they must come back as failed so the
		// caller re-enqueues them.
		assert.equal(result.failedCount, 2);
		assert.deepEqual(result.failedMessageIds.sort(), ["m-2", "m-3"]);
	});

	it("fails fast on a raw imapflow EConnectionClosed error (code-based detection)", async () => {
		const entries = [
			{ messageId: "m-1", uid: 11 },
			{ messageId: "m-2", uid: 12 },
		];
		const fake = buildMultiState(entries);
		const service = new BodySyncService(
			fake.messageService,
			fake.storageService,
			fake.threadMessageService,
			fake.addressService,
			fake.envelopeService,
		);

		// The bare error imapflow throws mid-FETCH — message text does NOT mention
		// "connection lost"; detection must be by code, not string.
		const rawDrop = Object.assign(new Error("Connection closed"), {
			code: "EConnectionClosed",
		});

		const result = await service.syncBodies(
			entries.map((e) => e.messageId),
			"acc-1",
			"acc-cfg-1",
			"INBOX",
			async () =>
				buildFakeConnection(undefined, {
					bodies: fake.bodies,
					dropAfter: 0,
					dropError: rawDrop,
				}),
		);

		assert.equal(result.syncedCount, 0);
		assert.equal(result.failedCount, 2);
		assert.deepEqual(result.failedMessageIds.sort(), ["m-1", "m-2"]);
	});

	it("propagates a non-connection error instead of swallowing it", async () => {
		const entries = [{ messageId: "m-1", uid: 11 }];
		const fake = buildMultiState(entries);
		const service = new BodySyncService(
			fake.messageService,
			fake.storageService,
			fake.threadMessageService,
			fake.addressService,
			fake.envelopeService,
		);

		await assert.rejects(
			service.syncBodies(["m-1"], "acc-1", "acc-cfg-1", "INBOX", async () =>
				buildFakeConnection(undefined, {
					bodies: fake.bodies,
					dropAfter: 0,
					dropError: new Error("kaboom: a real bug"),
				}),
			),
			/kaboom/,
		);
	});

	it("skips already-stored bodies and never fetches them", async () => {
		const entries = [
			{ messageId: "m-1", uid: 11, alreadyStored: true },
			{ messageId: "m-2", uid: 12 },
		];
		const fake = buildMultiState(entries);

		const calls: FakeConnectionCalls = {
			openBoxCount: 0,
			fetchBatchCount: 0,
			fetchedUidBatches: [],
		};
		const service = new BodySyncService(
			fake.messageService,
			fake.storageService,
			fake.threadMessageService,
			fake.addressService,
			fake.envelopeService,
		);

		const result = await service.syncBodies(
			entries.map((e) => e.messageId),
			"acc-1",
			"acc-cfg-1",
			"INBOX",
			async () =>
				buildFakeConnection(undefined, { bodies: fake.bodies, calls }),
		);

		assert.equal(result.skippedCount, 1);
		assert.equal(result.syncedCount, 1);
		assert.deepEqual(
			calls.fetchedUidBatches,
			[[12]],
			"only the un-stored UID is fetched",
		);
	});

	it("force absent: an already-stored body is still skipped (default behavior preserved)", async () => {
		// Same stale-metadata shape as the `force` case below (bodyStorageKey set)
		// but called without the `force` argument — must reproduce the original
		// skip-guard behavior exactly, so existing callers (bulk metadata-sync)
		// are unaffected by the new parameter.
		const entries = [{ messageId: "m-stale", uid: 21, alreadyStored: true }];
		const fake = buildMultiState(entries);
		const calls: FakeConnectionCalls = {
			openBoxCount: 0,
			fetchBatchCount: 0,
			fetchedUidBatches: [],
		};
		const service = new BodySyncService(
			fake.messageService,
			fake.storageService,
			fake.threadMessageService,
			fake.addressService,
			fake.envelopeService,
		);

		const result = await service.syncBodies(
			["m-stale"],
			"acc-1",
			"acc-cfg-1",
			"INBOX",
			async () =>
				buildFakeConnection(undefined, { bodies: fake.bodies, calls }),
		);

		assert.equal(result.skippedCount, 1);
		assert.equal(result.syncedCount, 0);
		assert.deepEqual(fake.storedStreamIds, []);
		assert.deepEqual(calls.fetchedUidBatches, []);
	});

	it("force=true: re-fetches and rewrites a message whose bodyStorageKey is set but the storage object is gone (#1241 stale-metadata loop)", async () => {
		// Regression for the self-heal convergence bug: the DB row already has
		// bodyStorageKey set (e.g. an adopted database whose storage tree is
		// gone), so the plain skip guard would leave `pending` empty and the
		// worker would report "processed" without ever fetching from IMAP —
		// the read path's /content re-arm would then 202 forever. The `force`
		// cue (set only by BodySyncQueueService.requestBodySync on a read miss)
		// must bypass the skip guard, re-fetch from IMAP, and rewrite
		// body.eml (+ parsed.json.gz) even though bodyStorageKey was set.
		const entries = [{ messageId: "m-stale", uid: 21, alreadyStored: true }];
		const fake = buildMultiState(entries);
		const calls: FakeConnectionCalls = {
			openBoxCount: 0,
			fetchBatchCount: 0,
			fetchedUidBatches: [],
		};
		const service = new BodySyncService(
			fake.messageService,
			fake.storageService,
			fake.threadMessageService,
			fake.addressService,
			fake.envelopeService,
		);

		const result = await service.syncBodies(
			["m-stale"],
			"acc-1",
			"acc-cfg-1",
			"INBOX",
			async () =>
				buildFakeConnection(undefined, { bodies: fake.bodies, calls }),
			true,
		);

		assert.equal(result.skippedCount, 0, "the skip guard is bypassed");
		assert.equal(result.syncedCount, 1);
		assert.deepEqual(result.syncedMessageIds, ["m-stale"]);
		assert.deepEqual(
			calls.fetchedUidBatches,
			[[21]],
			"the already-stored UID is fetched from IMAP anyway",
		);
		assert.deepEqual(
			fake.storedStreamIds,
			["m-stale"],
			"body.eml is rewritten to storage",
		);
	});
});

describe("BodySyncService.syncBodies (single consolidated Message write, #607)", () => {
	// Newsletter with an aligned DKIM signature exercises every derived field:
	// category, hasListUnsubscribe, and authenticity — all of which must land on
	// the ONE Message UpdateItem alongside bodyStorageKey.
	const RICH_EML = Buffer.from(
		[
			"From: news@news.example.com",
			"To: bob@example.com",
			"Subject: weekly digest",
			"Message-ID: <rich-1@news.example.com>",
			"List-Id: <weekly.news.example.com>",
			"List-Unsubscribe: <https://news.example.com/u>",
			"DKIM-Signature: v=1; a=rsa-sha256; d=news.example.com; s=sel; b=xxx",
			"Content-Type: text/plain",
			"",
			"weekly digest body",
			"",
		].join("\r\n"),
	);

	it("issues exactly ONE Message UpdateItem per synced message, carrying every derived field", async () => {
		const fake = buildFakeState({ messageId: "msg-1", rawEml: RICH_EML });
		const service = new BodySyncService(
			fake.messageService,
			fake.storageService,
			fake.threadMessageService,
			fake.addressService,
			fake.envelopeService,
		);

		await service.syncBodies(
			["msg-1"],
			"acc-1",
			"acc-cfg-1",
			"INBOX",
			async () => buildFakeConnection(RICH_EML),
		);

		const messageWrites = fake.updatedKeys.filter(
			(u) => u.messageId === "msg-1",
		);
		assert.equal(
			messageWrites.length,
			1,
			"exactly one Message UpdateItem per synced message",
		);

		const write = messageWrites[0];
		assert.ok(write.bodyStorageKey, "bodyStorageKey is on the single write");
		assert.equal(write.category, MessageCategory.newsletter);
		assert.equal(write.hasListUnsubscribe, true);
		assert.ok(write.authenticity, "authenticity is on the single write");
		assert.equal(write.authenticity?.dkimMismatch, false);
	});

	it("still writes the ThreadMessage snippet (separate entity, not a Message write)", async () => {
		const fake = buildFakeState({ messageId: "msg-1", rawEml: RICH_EML });
		const service = new BodySyncService(
			fake.messageService,
			fake.storageService,
			fake.threadMessageService,
			fake.addressService,
			fake.envelopeService,
		);

		await service.syncBodies(
			["msg-1"],
			"acc-1",
			"acc-cfg-1",
			"INBOX",
			async () => buildFakeConnection(RICH_EML),
		);

		assert.equal(
			fake.threadSnippetUpdates.length,
			1,
			"ThreadMessage snippet write still happens",
		);
		assert.equal(fake.threadSnippetUpdates[0].threadMessageId, "tm-1");
		assert.equal(
			fake.threadSnippetUpdates[0].category,
			MessageCategory.newsletter,
			"the classified category is denormalized onto the ThreadMessage",
		);
	});

	it("denormalizes category onto the ThreadMessage even with no Message-ID header, matching the Message write", async () => {
		// A message whose RFC822 Message-ID header is absent still classifies and
		// must land the SAME category on both the Message and the ThreadMessage —
		// the worker indexes off the ThreadMessage, so a stale `uncategorized`
		// there would index the wrong category (#delta-review).
		const HEADERLESS_NEWSLETTER = Buffer.from(
			[
				"From: news@news.example.com",
				"To: bob@example.com",
				"Subject: weekly digest",
				"List-Id: <weekly.news.example.com>",
				"List-Unsubscribe: <https://news.example.com/u>",
				"Content-Type: text/plain",
				"",
				"weekly digest body",
				"",
			].join("\r\n"),
		);
		const fake = buildFakeState({
			messageId: "msg-1",
			rawEml: HEADERLESS_NEWSLETTER,
			messageOverrides: { messageIdHeader: undefined },
		});
		const service = new BodySyncService(
			fake.messageService,
			fake.storageService,
			fake.threadMessageService,
			fake.addressService,
			fake.envelopeService,
		);

		await service.syncBodies(
			["msg-1"],
			"acc-1",
			"acc-cfg-1",
			"INBOX",
			async () => buildFakeConnection(HEADERLESS_NEWSLETTER),
		);

		const messageWrite = fake.updatedKeys.find((u) => u.messageId === "msg-1");
		assert.ok(messageWrite, "the Message write happens");
		assert.equal(messageWrite.category, MessageCategory.newsletter);

		assert.equal(
			fake.threadSnippetUpdates.length,
			1,
			"ThreadMessage update still happens without a Message-ID header",
		);
		assert.equal(
			fake.threadSnippetUpdates[0].category,
			messageWrite.category,
			"ThreadMessage.category matches Message.category for a headerless message",
		);
	});

	it("folds the rescue movedByRemit flag into the same single Message write", async () => {
		// A rescueable Junk message: one Message write must carry BOTH the
		// classification fields AND movedByRemit, not a second UpdateItem.
		const fake = buildFakeState({
			messageId: "msg-rescue",
			rawEml: RICH_EML,
			messageOverrides: {
				mailboxId: "junk-mbx",
				movedByRemit: false,
				providerSpam: { classified: true },
				authResult: { dmarc: "Pass" },
			},
		});
		const addressService = {
			incrementInboundCount: async () => {},
			getAddress: async () => ({
				flags: { vip: { value: true }, wellknown: { value: false } },
			}),
		} as unknown as AddressService;
		const mailboxSpecialUseService = {
			findBySpecialUse: async (
				_accountId: string,
				specialUse: (typeof MailboxSpecialUse)[keyof typeof MailboxSpecialUse],
			) =>
				specialUse === MailboxSpecialUse.Junk
					? { mailboxId: "junk-mbx", fullPath: "Junk" }
					: null,
			findInboxMailbox: async () => ({
				mailboxId: "inbox-mbx",
				fullPath: "INBOX",
			}),
		} as unknown as MailboxSpecialUseService;
		const moveCalls: string[] = [];
		const messageMoveService = {
			moveMessage: async (_accountConfigId: string, messageId: string) => {
				moveCalls.push(messageId);
			},
		} as unknown as MessageMoveService;

		const service = new BodySyncService(
			fake.messageService,
			fake.storageService,
			fake.threadMessageService,
			addressService,
			fake.envelopeService,
			undefined,
			{ mailboxSpecialUseService, messageMoveService },
		);

		const result = await service.syncBodies(
			["msg-rescue"],
			"acc-1",
			"acc-cfg-1",
			"Junk",
			async () => buildFakeConnection(RICH_EML),
		);

		assert.equal(result.syncedCount, 1);
		assert.deepEqual(moveCalls, ["msg-rescue"]);

		const messageWrites = fake.updatedKeys.filter(
			(u) => u.messageId === "msg-rescue",
		);
		assert.equal(
			messageWrites.length,
			1,
			"rescue does NOT add a second Message UpdateItem",
		);
		assert.equal(messageWrites[0].movedByRemit, true);
		assert.ok(messageWrites[0].bodyStorageKey, "bodyStorageKey on same write");
		assert.equal(messageWrites[0].category, MessageCategory.newsletter);
	});
});

describe("BodySyncService.fetchAndGetBody (storage retrieval error handling)", () => {
	const namedError = (name: string): Error =>
		Object.assign(new Error(name), { name });

	it("falls back to IMAP when the stored object is missing (NoSuchKey)", async () => {
		const fake = buildFakeState({
			messageId: "msg-missing",
			hasBodyStorageKey: true,
		});
		const storage: StorageService = {
			...fake.storageService,
			retrieve: async () => {
				throw namedError("NoSuchKey");
			},
		};
		const service = new BodySyncService(
			fake.messageService,
			storage,
			fake.threadMessageService,
			fake.addressService,
			fake.envelopeService,
		);

		const result = await service.fetchAndGetBody(
			"msg-missing",
			"acc-1",
			"acc-cfg-1",
			"INBOX",
			async () => buildFakeConnection(),
		);

		// IMAP fallback produced the body and re-stored it.
		assert.ok(result.text?.includes("hello world body"));
		assert.equal(fake.storedBodies.length, 1);
	});

	it("does NOT fall back to IMAP on a non-NoSuchKey error (AccessDenied); rejects", async () => {
		const fake = buildFakeState({
			messageId: "msg-denied",
			hasBodyStorageKey: true,
		});
		const storage: StorageService = {
			...fake.storageService,
			retrieve: async () => {
				throw namedError("AccessDenied");
			},
		};
		const service = new BodySyncService(
			fake.messageService,
			storage,
			fake.threadMessageService,
			fake.addressService,
			fake.envelopeService,
		);

		await assert.rejects(
			() =>
				service.fetchAndGetBody(
					"msg-denied",
					"acc-1",
					"acc-cfg-1",
					"INBOX",
					async () => buildFakeConnection(),
				),
			/AccessDenied/,
		);
		// No IMAP re-store happened — the permission error was surfaced, not masked.
		assert.equal(fake.storedBodies.length, 0);
	});
});

describe("BodySyncService.deriveSenderTrust (error propagation via rescue)", () => {
	// deriveSenderTrust is private; exercise it through the placement path, which
	// calls it from resolvePlacement. A missing Address must degrade to "no move"
	// with no warning; any other failure (AccessDenied/throttle) must propagate up
	// through computePlacement so resolvePlacement's isolating catch logs it loudly
	// (observable via the `body_sync_placement_failed` alert) rather than either
	// silently downgrading to SenderTrust.Unknown or failing the whole message
	// store over an auxiliary placement decision.
	const rescueableMessageOverrides = {
		mailboxId: "junk-mbx",
		movedByRemit: false,
		providerSpam: { classified: true },
		authResult: { dmarc: "Pass" },
	};

	const buildRescueConfig = () => {
		const mailboxSpecialUseService = {
			findBySpecialUse: async (
				_accountId: string,
				specialUse: (typeof MailboxSpecialUse)[keyof typeof MailboxSpecialUse],
			) =>
				specialUse === MailboxSpecialUse.Junk
					? { mailboxId: "junk-mbx", fullPath: "Junk" }
					: null,
			findInboxMailbox: async () => ({
				mailboxId: "inbox-mbx",
				fullPath: "INBOX",
			}),
		} as unknown as MailboxSpecialUseService;
		const messageMoveService = {
			moveMessage: async () => {},
		} as unknown as MessageMoveService;
		return { mailboxSpecialUseService, messageMoveService };
	};

	const captureWarnings = () => {
		const warnings: Array<{ obj: Record<string, unknown>; msg: string }> = [];
		const logger: BodySyncLogger = {
			info: () => {},
			debug: () => {},
			warn: (obj, msg) => warnings.push({ obj, msg }),
			error: () => {},
		};
		return { logger, warnings };
	};

	const RESCUE_EML = Buffer.from(
		[
			"From: vip@example.com",
			"To: me@example.com",
			"Subject: hi",
			"Message-ID: <vip-1@example.com>",
			"Content-Type: text/plain",
			"",
			"body",
			"",
		].join("\r\n"),
	);

	it("treats a missing Address (NotFoundError) as Unknown trust: no rescue, no warning", async () => {
		const fake = buildFakeState({
			messageId: "msg-nf",
			rawEml: RESCUE_EML,
			messageOverrides: rescueableMessageOverrides,
		});
		const addressService = {
			incrementInboundCount: async () => {},
			getAddress: async () => {
				throw new NotFoundError("Address not found: x");
			},
		} as unknown as AddressService;
		const { logger, warnings } = captureWarnings();
		const service = new BodySyncService(
			fake.messageService,
			fake.storageService,
			fake.threadMessageService,
			addressService,
			fake.envelopeService,
			logger,
			buildRescueConfig(),
		);

		const result = await service.syncBodies(
			["msg-nf"],
			"acc-1",
			"acc-cfg-1",
			"Junk",
			async () => buildFakeConnection(RESCUE_EML),
		);

		// Unknown trust ⇒ verdict is unsure ⇒ no move, and the absence is NOT a
		// placement failure, so no warning is emitted.
		assert.equal(result.syncedCount, 1);
		assert.ok(
			!warnings.some((w) => w.msg.includes("Placement move failed")),
			"a missing Address must not be logged as a placement failure",
		);
	});

	it("isolates the message from a placement trust-derivation failure (AccessDenied) — body still stored, alert logged", async () => {
		const fake = buildFakeState({
			messageId: "msg-denied-trust",
			rawEml: RESCUE_EML,
			messageOverrides: rescueableMessageOverrides,
		});
		const addressService = {
			incrementInboundCount: async () => {},
			getAddress: async () => {
				throw Object.assign(new Error("AccessDenied"), {
					name: "AccessDenied",
				});
			},
		} as unknown as AddressService;
		const errors: Array<{ obj: Record<string, unknown>; msg: string }> = [];
		const logger: BodySyncLogger = {
			info: () => {},
			debug: () => {},
			warn: () => {},
			error: (obj, msg) => errors.push({ obj, msg }),
		};
		const service = new BodySyncService(
			fake.messageService,
			fake.storageService,
			fake.threadMessageService,
			addressService,
			fake.envelopeService,
			logger,
			buildRescueConfig(),
		);

		const result = await service.syncBodies(
			["msg-denied-trust"],
			"acc-1",
			"acc-cfg-1",
			"Junk",
			async () => buildFakeConnection(RESCUE_EML),
		);

		// Placement is auxiliary to the body store: an AccessDenied surfacing
		// from trust derivation is caught by resolvePlacement's isolating catch,
		// so the message still syncs and its already-stored body is never
		// requeued forever over a placement-only fault.
		assert.equal(result.syncedCount, 1);
		assert.equal(result.failedCount, 0);
		assert.deepEqual(result.syncedMessageIds, ["msg-denied-trust"]);
		assert.equal(fake.storedBodies.length, 1, "body.eml stored");
		const alertLog = errors.find(
			(e) => e.obj.alert === "body_sync_placement_failed",
		);
		assert.ok(
			alertLog,
			"expected an alert-tagged placement-failure log for AccessDenied",
		);
		assert.match(String(alertLog?.obj.error), /AccessDenied/);
	});
});
