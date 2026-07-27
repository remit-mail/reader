/**
 * Issue #302 (RFC 039 Decision 3): `Address.flags.unsubscribed` is
 * documented as "auto-mark-read until sender stops" and settable from
 * `IntelligencePane.tsx`, but nothing consumed it — every message from an
 * unsubscribed sender still arrived unread like any other. These tests drive
 * `BodySyncService` end-to-end (read-path body materialization →
 * `applyPostStoreSteps`) and assert on the actual `FlagQueueService.markAsRead`
 * call, so a regression that drops the flag read — not just a helper in
 * isolation — shows up here.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type {
	AddressItem,
	IAddressRepository,
	IEnvelopeRepository,
	IMessageRepository,
	IThreadMessageRepository,
} from "@remit/data-ports";
import type { StorageService } from "@remit/storage-service";
import { BodySyncService } from "./body-sync.js";
import type { FlagQueueService } from "./flag-queue.js";
import type { IImapConnection } from "./types.js";

const PLAIN_EML = (fromEmail: string) =>
	Buffer.from(
		[
			`From: Sender <${fromEmail}>`,
			"To: me@example.com",
			"Subject: Hello",
			"Content-Type: text/plain",
			"",
			"body",
		].join("\r\n"),
	);

interface MarkReadCall {
	accountConfigId: string;
	messageId: string;
	accountId: string;
}

interface Harness {
	service: BodySyncService;
	markReadCalls: MarkReadCall[];
}

const buildHarness = (
	flags: AddressItem["flags"],
	withUnsubscribeConfig = true,
): Harness => {
	const markReadCalls: MarkReadCall[] = [];

	const messageService = {
		get: async () => ({
			messageId: "m-1",
			mailboxId: "mb-inbox",
			uid: 1,
		}),
		update: async () => {},
	} as unknown as IMessageRepository;

	const threadMessageService = {
		findAllByMessageId: async () => [
			{
				threadMessageId: "tm-1",
				sentDate: 1,
				mailboxId: "mb-inbox",
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

	const flagQueueService = {
		markAsRead: async (
			accountConfigId: string,
			messageId: string,
			accountId: string,
		) => {
			markReadCalls.push({ accountConfigId, messageId, accountId });
		},
	} as unknown as FlagQueueService;

	const service = new BodySyncService(
		messageService,
		storageService,
		threadMessageService,
		addressService,
		envelopeService,
		{ info: () => {}, error: () => {} },
		undefined,
		undefined,
		undefined,
		withUnsubscribeConfig ? { flagQueueService } : undefined,
	);

	return { service, markReadCalls };
};

const readBody = async (
	service: BodySyncService,
	fromEmail = "someone@example.com",
) => {
	const connection = {
		openBox: async () => {},
		fetchMessageBody: async () => PLAIN_EML(fromEmail),
	} as unknown as IImapConnection;
	return service.fetchAndGetBody(
		"m-1",
		"acc-1",
		"cfg-1",
		"INBOX",
		async () => connection,
	);
};

describe("Address.flags.unsubscribed drives auto-mark-read (issue #302)", () => {
	it("marks a message from an unsubscribed sender as read at sync time", async () => {
		const harness = buildHarness({ unsubscribed: { value: true, setAt: 1 } });

		await readBody(harness.service);

		assert.deepEqual(harness.markReadCalls, [
			{ accountConfigId: "cfg-1", messageId: "m-1", accountId: "acc-1" },
		]);
	});

	it("leaves read state alone for a sender without the flag", async () => {
		const harness = buildHarness({});

		await readBody(harness.service);

		assert.deepEqual(harness.markReadCalls, []);
	});

	it("leaves read state alone once the flag is unset (no caching of the decision)", async () => {
		const harness = buildHarness({
			unsubscribed: { value: false, setAt: 1 },
		});

		await readBody(harness.service);

		assert.deepEqual(harness.markReadCalls, []);
	});

	it("is a no-op when body sync was built without an UnsubscribeConfig", async () => {
		const harness = buildHarness(
			{ unsubscribed: { value: true, setAt: 1 } },
			false,
		);

		await readBody(harness.service);

		assert.deepEqual(harness.markReadCalls, []);
	});
});
