import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type {
	AddressItem,
	LabelItem,
	MessageItem,
	MessageLabelItem,
	ThreadMessageItem,
} from "@remit/data-ports";
import { deriveAddressId } from "@remit/data-ports/id";
import { type EnrichClient, enrichThreadRows } from "./enrichThreadRows.js";

const threadRow = (
	threadMessageId: string,
	messageId: string,
	fromEmail?: string,
): ThreadMessageItem =>
	({
		threadMessageId,
		threadId: "th-1",
		messageId,
		accountConfigId: "acc-1",
		mailboxId: "mbx-1",
		fromEmail,
		sentDate: 1,
		isRead: true,
		hasAttachment: false,
		hasStars: false,
		isDeleted: false,
		createdAt: 1,
		updatedAt: 1,
	}) as unknown as ThreadMessageItem;

const buildClient = (
	messageLabels: MessageLabelItem[],
	labels: LabelItem[],
	addresses: AddressItem[] = [],
): EnrichClient => ({
	message: { get: async () => [] as MessageItem[] },
	address: { getAddress: async () => addresses },
	messageLabel: {
		listByMessageIds: async (messageIds: string[]) =>
			messageLabels.filter((row) => messageIds.includes(row.messageId)),
	},
	label: {
		listByAccountConfig: async () => labels,
	},
});

describe("enrichThreadRows — labels", () => {
	test("attaches every label applied to a message", async () => {
		const rows = [threadRow("tm-1", "msg-1")];
		const messageLabels = [
			{
				messageLabelId: "ml-1",
				messageId: "msg-1",
				labelId: "lbl-1",
				accountConfigId: "acc-1",
				createdAt: 1,
				updatedAt: 1,
			},
			{
				messageLabelId: "ml-2",
				messageId: "msg-1",
				labelId: "lbl-2",
				accountConfigId: "acc-1",
				createdAt: 1,
				updatedAt: 1,
			},
		] as unknown as MessageLabelItem[];
		const labels = [
			{
				labelId: "lbl-1",
				accountConfigId: "acc-1",
				name: "Receipts",
				normalizedName: "receipts",
				color: "Blue",
				createdAt: 1,
				updatedAt: 1,
			},
			{
				labelId: "lbl-2",
				accountConfigId: "acc-1",
				name: "Travel",
				normalizedName: "travel",
				color: "Green",
				createdAt: 1,
				updatedAt: 1,
			},
		] as unknown as LabelItem[];

		const [result] = await enrichThreadRows(
			rows,
			buildClient(messageLabels, labels),
			"acc-1",
		);

		assert.deepEqual(result?.labels?.map((l) => l.labelId).sort(), [
			"lbl-1",
			"lbl-2",
		]);
		assert.deepEqual(
			result?.labels?.find((l) => l.labelId === "lbl-1"),
			{ labelId: "lbl-1", name: "Receipts", color: "Blue" },
		);
	});

	test("omits labels entirely when the message has none", async () => {
		const rows = [threadRow("tm-1", "msg-1")];
		const [result] = await enrichThreadRows(rows, buildClient([], []), "acc-1");
		assert.equal(result?.labels, undefined);
	});

	test("skips a MessageLabel row whose Label was deleted out from under it", async () => {
		const rows = [threadRow("tm-1", "msg-1")];
		const messageLabels = [
			{
				messageLabelId: "ml-1",
				messageId: "msg-1",
				labelId: "gone",
				accountConfigId: "acc-1",
				createdAt: 1,
				updatedAt: 1,
			},
		] as unknown as MessageLabelItem[];

		const [result] = await enrichThreadRows(
			rows,
			buildClient(messageLabels, []),
			"acc-1",
		);
		assert.equal(result?.labels, undefined);
	});

	test("never cross-wires labels between rows for different messages", async () => {
		const rows = [threadRow("tm-1", "msg-1"), threadRow("tm-2", "msg-2")];
		const messageLabels = [
			{
				messageLabelId: "ml-1",
				messageId: "msg-1",
				labelId: "lbl-1",
				accountConfigId: "acc-1",
				createdAt: 1,
				updatedAt: 1,
			},
		] as unknown as MessageLabelItem[];
		const labels = [
			{
				labelId: "lbl-1",
				accountConfigId: "acc-1",
				name: "Receipts",
				normalizedName: "receipts",
				color: "Blue",
				createdAt: 1,
				updatedAt: 1,
			},
		] as unknown as LabelItem[];

		const [first, second] = await enrichThreadRows(
			rows,
			buildClient(messageLabels, labels),
			"acc-1",
		);
		assert.equal(first?.labels?.length, 1);
		assert.equal(second?.labels, undefined);
	});
});

describe("enrichThreadRows — muted", () => {
	const SET_AT = 1_700_000_000_000;

	test("sets muted true from the batch-fetched Address's flags, no extra query", async () => {
		const fromEmail = "muted@example.com";
		const addressId = deriveAddressId("acc-1", fromEmail);
		const rows = [threadRow("tm-1", "msg-1", fromEmail)];
		const addresses = [
			{
				addressId,
				accountConfigId: "acc-1",
				flags: { muted: { value: true, setAt: SET_AT } },
			},
		] as unknown as AddressItem[];

		let addressCalls = 0;
		const client: EnrichClient = {
			message: { get: async () => [] as MessageItem[] },
			address: {
				getAddress: async () => {
					addressCalls += 1;
					return addresses;
				},
			},
			messageLabel: { listByMessageIds: async () => [] },
			label: { listByAccountConfig: async () => [] },
		};

		const [result] = await enrichThreadRows(rows, client, "acc-1");
		assert.equal(result?.muted, true);
		assert.equal(addressCalls, 1);
	});

	test("defaults muted to false when the Address has no muted flag", async () => {
		const fromEmail = "not-muted@example.com";
		const addressId = deriveAddressId("acc-1", fromEmail);
		const rows = [threadRow("tm-1", "msg-1", fromEmail)];
		const addresses = [
			{ addressId, accountConfigId: "acc-1", flags: {} },
		] as unknown as AddressItem[];

		const [result] = await enrichThreadRows(
			rows,
			buildClient([], [], addresses),
			"acc-1",
		);
		assert.equal(result?.muted, false);
	});

	test("defaults muted to false when no Address row resolves", async () => {
		const rows = [threadRow("tm-1", "msg-1")];
		const [result] = await enrichThreadRows(rows, buildClient([], []), "acc-1");
		assert.equal(result?.muted, false);
	});
});
