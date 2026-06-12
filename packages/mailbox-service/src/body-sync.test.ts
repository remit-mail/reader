import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	AddressService,
	type BodyPartItem,
	type EnvelopeService,
	type MessageService,
	type ThreadMessageService,
	type UpdateMessageInput,
} from "@remit/remit-electrodb-service";
import { MessageCategory } from "@remit/domain-enums";
import type {
	StorageReference,
	StorageService,
	StoreBodyPartParams,
	StoreMessageBodyParams,
	StoreParsedBodyParams,
} from "@remit/storage-service";
import { BodySyncService } from "./body-sync.js";
import type { IImapConnection } from "./types.js";

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
}

const buildFakeState = (opts: FakeStateOptions) => {
	const storedBodies: StoreMessageBodyParams[] = [];
	const storedParsed: StoreParsedBodyParams[] = [];
	const storedBodyParts: StoreBodyPartParams[] = [];
	const updatedKeys: Array<{ messageId: string } & UpdateMessageInput> = [];
	const inboundIncrements: Array<{ addressId: string; now: number }> = [];

	const message = {
		messageId: opts.messageId,
		mailboxId: "mbx-1",
		uid: 42,
		messageIdHeader: "<abc@example.com>",
		bodyStorageKey: opts.hasBodyStorageKey
			? "s3://bucket/accounts/acc-cfg-1/acc-1/messages/msg-1/body.eml"
			: undefined,
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
		incrementInboundCount: async (addressId: string, now: number) => {
			inboundIncrements.push({ addressId, now });
		},
	} as unknown as AddressService;

	const threadMessageService = {
		getByMessageId: async () => ({
			threadMessageId: "tm-1",
			messageId: opts.messageId,
		}),
		update: async () => ({}),
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
		retrieve: async () => opts.rawEml ?? A_RAW_EML,
		exists: async () => true,
		delete: async () => {},
	};

	const envelopeService = {
		listBodyParts: async (id: string): Promise<BodyPartItem[]> => {
			assert.equal(id, opts.messageId);
			return opts.bodyParts ?? [];
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
		inboundIncrements,
	};
};

const buildFakeConnection = (rawEml?: Buffer): IImapConnection => {
	return {
		openBox: async () => ({}),
		fetchMessageBody: async () => rawEml ?? A_RAW_EML,
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

	it("does not fail the whole body sync when parsed-cache write throws", async () => {
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

		assert.equal(result.syncedCount, 1);
		assert.equal(fake.storedBodies.length, 1);
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
