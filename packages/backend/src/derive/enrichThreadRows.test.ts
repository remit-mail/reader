import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type {
	AddressItem,
	MessageItem,
	ThreadMessageItem,
} from "@remit/remit-electrodb-service";
import { AddressService } from "@remit/remit-electrodb-service";
import {
	type EnrichClient,
	enrichThreadRows,
	planBatchFetch,
} from "./enrichThreadRows.js";

const ACCOUNT_CONFIG_ID = "alice-account-config";

const buildRow = (
	overrides: Partial<ThreadMessageItem> & {
		threadMessageId: string;
		messageId: string;
	},
): ThreadMessageItem =>
	({
		threadId: "thread-1",
		accountConfigId: ACCOUNT_CONFIG_ID,
		mailboxId: "alice-mb-inbox",
		uid: 1,
		referenceOrder: 0,
		fromEmail: "bob@example.com",
		fromName: "Bob",
		subject: "hi",
		internalDate: 1_700_000_000_000,
		sentDate: 1_700_000_000_000,
		isRead: false,
		hasAttachment: false,
		hasStars: false,
		isDeleted: false,
		createdAt: 1_700_000_000_000,
		updatedAt: 1_700_000_000_000,
		...overrides,
	}) as ThreadMessageItem;

const buildMessage = (
	messageId: string,
	overrides: Partial<MessageItem> = {},
): MessageItem =>
	({
		messageId,
		mailboxId: "alice-mb-inbox",
		uid: 1,
		sequenceNumber: 1,
		rfc822Size: 100,
		internalDate: 1_700_000_000_000,
		envelopeId: "env-1",
		rootBodyPartId: "bp-1",
		createdAt: 1_700_000_000_000,
		updatedAt: 1_700_000_000_000,
		...overrides,
	}) as MessageItem;

const buildAddress = (
	addressId: string,
	overrides: Partial<AddressItem> = {},
): AddressItem =>
	({
		addressId,
		accountConfigId: ACCOUNT_CONFIG_ID,
		localPart: "bob",
		domain: "example.com",
		normalizedEmail: "bob@example.com",
		normalizedCompound: "bob@example.com",
		createdAt: 1_700_000_000_000,
		updatedAt: 1_700_000_000_000,
		...overrides,
	}) as AddressItem;

const buildClient = (opts: {
	messages: MessageItem[];
	addresses: AddressItem[];
	onMessageGet?: (ids: string[]) => void;
	onAddressGet?: (ids: string[]) => void;
}): EnrichClient => ({
	message: {
		get: async (ids: string[]) => {
			opts.onMessageGet?.(ids);
			return opts.messages.filter((m) => ids.includes(m.messageId));
		},
	},
	address: {
		getAddress: async (ids: string[]) => {
			opts.onAddressGet?.(ids);
			return opts.addresses.filter((a) => ids.includes(a.addressId));
		},
	},
});

describe("planBatchFetch", () => {
	it("dedupes messageIds and addressIds across rows from the same sender", () => {
		const sameMessage = "msg-shared";
		const rows = [
			buildRow({
				threadMessageId: "tm-1",
				messageId: sameMessage,
				fromEmail: "bob@example.com",
			}),
			buildRow({
				threadMessageId: "tm-2",
				messageId: sameMessage,
				fromEmail: "bob@example.com",
			}),
			buildRow({
				threadMessageId: "tm-3",
				messageId: "msg-other",
				fromEmail: "bob@example.com",
			}),
		];

		const plan = planBatchFetch(rows);

		assert.deepEqual(plan.messageIds.sort(), ["msg-other", "msg-shared"]);
		assert.equal(plan.addressIds.length, 1);
		assert.equal(plan.addressIdByRow.size, 3);
	});

	it("keeps a 50-row page from one sender to a single addressId", () => {
		const rows = Array.from({ length: 50 }, (_, idx) =>
			buildRow({
				threadMessageId: `tm-${idx}`,
				messageId: `msg-${idx}`,
				fromEmail: "bob@example.com",
			}),
		);

		const plan = planBatchFetch(rows);

		assert.equal(plan.messageIds.length, 50);
		assert.equal(plan.addressIds.length, 1);
	});

	it("skips rows without a fromEmail", () => {
		const rows = [
			buildRow({
				threadMessageId: "tm-1",
				messageId: "msg-1",
				fromEmail: undefined,
			}),
			buildRow({
				threadMessageId: "tm-2",
				messageId: "msg-2",
				fromEmail: "bob@example.com",
			}),
		];

		const plan = planBatchFetch(rows);

		assert.equal(plan.addressIds.length, 1);
		assert.equal(plan.addressIdByRow.has("tm-1"), false);
		assert.equal(plan.addressIdByRow.has("tm-2"), true);
	});
});

describe("enrichThreadRows", () => {
	it("attaches category from Message and senderTrust from Address flags", async () => {
		const bobAddressId = AddressService.generateAddressId(
			ACCOUNT_CONFIG_ID,
			"bob@example.com",
		);

		const rows = [
			buildRow({
				threadMessageId: "tm-1",
				messageId: "msg-1",
				fromEmail: "bob@example.com",
			}),
		];

		const client = buildClient({
			messages: [buildMessage("msg-1", { category: "newsletter" })],
			addresses: [
				buildAddress(bobAddressId, {
					flags: { wellknown: { value: true, setAt: 1_700_000_000_000 } },
				}),
			],
		});

		const enriched = await enrichThreadRows(rows, client);

		assert.equal(enriched[0].category, "newsletter");
		assert.equal(enriched[0].senderTrust, "wellknown");
	});

	it("falls back to senderTrust='unknown' when the Address row is missing", async () => {
		const rows = [
			buildRow({
				threadMessageId: "tm-1",
				messageId: "msg-1",
				fromEmail: "bob@example.com",
			}),
		];

		const client = buildClient({
			messages: [buildMessage("msg-1")],
			addresses: [],
		});

		const enriched = await enrichThreadRows(rows, client);

		assert.equal(enriched[0].senderTrust, "unknown");
		assert.equal(enriched[0].category, "uncategorized");
	});

	it("issues exactly one BatchGet for messages and one for addresses, dedup'd", async () => {
		let messageBatches = 0;
		let addressBatches = 0;
		const messageBatchSizes: number[] = [];
		const addressBatchSizes: number[] = [];

		const rows = Array.from({ length: 50 }, (_, idx) =>
			buildRow({
				threadMessageId: `tm-${idx}`,
				messageId: `msg-${idx % 10}`,
				fromEmail: "bob@example.com",
			}),
		);

		const bobAddressId = AddressService.generateAddressId(
			ACCOUNT_CONFIG_ID,
			"bob@example.com",
		);

		const client = buildClient({
			messages: Array.from({ length: 10 }, (_, idx) =>
				buildMessage(`msg-${idx}`),
			),
			addresses: [buildAddress(bobAddressId)],
			onMessageGet: (ids) => {
				messageBatches += 1;
				messageBatchSizes.push(ids.length);
			},
			onAddressGet: (ids) => {
				addressBatches += 1;
				addressBatchSizes.push(ids.length);
			},
		});

		await enrichThreadRows(rows, client);

		assert.equal(messageBatches, 1);
		assert.equal(addressBatches, 1);
		assert.equal(messageBatchSizes[0], 10);
		assert.equal(addressBatchSizes[0], 1);
	});

	it("derives senderTrust=vip when AddressFlags.vip.value is true", async () => {
		const bobAddressId = AddressService.generateAddressId(
			ACCOUNT_CONFIG_ID,
			"bob@example.com",
		);
		const rows = [
			buildRow({
				threadMessageId: "tm-1",
				messageId: "msg-1",
				fromEmail: "bob@example.com",
			}),
		];

		const client = buildClient({
			messages: [buildMessage("msg-1")],
			addresses: [
				buildAddress(bobAddressId, {
					flags: {
						vip: { value: true, setAt: 1_700_000_000_000 },
						wellknown: { value: true, setAt: 1_700_000_000_000 },
					},
				}),
			],
		});

		const enriched = await enrichThreadRows(rows, client);

		assert.equal(enriched[0].senderTrust, "vip");
	});

	it("returns [] without making BatchGet calls for an empty page", async () => {
		let messageBatches = 0;
		let addressBatches = 0;
		const client = buildClient({
			messages: [],
			addresses: [],
			onMessageGet: () => {
				messageBatches += 1;
			},
			onAddressGet: () => {
				addressBatches += 1;
			},
		});

		const enriched = await enrichThreadRows([], client);

		assert.deepEqual(enriched, []);
		assert.equal(messageBatches, 0);
		assert.equal(addressBatches, 0);
	});

	it("handles rows without a fromEmail by defaulting senderTrust='unknown'", async () => {
		const rows = [
			buildRow({
				threadMessageId: "tm-1",
				messageId: "msg-1",
				fromEmail: undefined,
			}),
		];

		const client = buildClient({
			messages: [buildMessage("msg-1", { category: "automated" })],
			addresses: [],
		});

		const enriched = await enrichThreadRows(rows, client);

		assert.equal(enriched[0].senderTrust, "unknown");
		assert.equal(enriched[0].category, "automated");
	});

	it("attaches authenticity from Message when present", async () => {
		const rows = [
			buildRow({
				threadMessageId: "tm-1",
				messageId: "msg-1",
				fromEmail: "alice@example.com",
			}),
		];

		const client = buildClient({
			messages: [
				buildMessage("msg-1", {
					authenticity: {
						fromDomain: "example.com",
						dkimDomain: "relay.net",
						dkimMismatch: true,
					},
				}),
			],
			addresses: [],
		});

		const enriched = await enrichThreadRows(rows, client);

		assert.ok(enriched[0].authenticity, "expected authenticity on response");
		assert.equal(enriched[0].authenticity?.fromDomain, "example.com");
		assert.equal(enriched[0].authenticity?.dkimDomain, "relay.net");
		assert.equal(enriched[0].authenticity?.dkimMismatch, true);
	});

	it("omits authenticity from response when Message row has none (pre-rollout)", async () => {
		const rows = [
			buildRow({
				threadMessageId: "tm-1",
				messageId: "msg-1",
				fromEmail: "alice@example.com",
			}),
		];

		const client = buildClient({
			messages: [buildMessage("msg-1")],
			addresses: [],
		});

		const enriched = await enrichThreadRows(rows, client);

		assert.equal(enriched[0].authenticity, undefined);
	});
});
