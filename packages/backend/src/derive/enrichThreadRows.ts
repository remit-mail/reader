import type { ThreadMessageResponse } from "@remit/api-openapi-types";
import { MessageCategory, SenderTrust, StarColor } from "@remit/domain-enums";
import type {
	AddressItem,
	MessageItem,
	ThreadMessageItem,
} from "@remit/remit-electrodb-service";
import { AddressService } from "@remit/remit-electrodb-service";
import { deriveAutoMoved } from "./autoMoved.js";
import { deriveSenderTrust } from "./senderTrust.js";

/**
 * Subset of the ElectroDB client surface used for batch enrichment. Declared
 * structurally so unit tests can pass an in-memory fake without standing up
 * DynamoDB.
 */
export interface EnrichClient {
	message: {
		get(messageIds: string[]): Promise<MessageItem[]>;
	};
	address: {
		getAddress(
			accountConfigId: string,
			addressIds: string[],
		): Promise<AddressItem[]>;
	};
}

const toResponse = (item: ThreadMessageItem): ThreadMessageResponse => ({
	threadMessageId: item.threadMessageId,
	threadId: item.threadId,
	messageId: item.messageId,
	accountConfigId: item.accountConfigId,
	mailboxId: item.mailboxId,
	fromEmail: item.fromEmail,
	fromName: item.fromName,
	subject: item.subject,
	sentDate: item.sentDate,
	isRead: item.isRead,
	hasAttachment: item.hasAttachment,
	star: item.star ?? StarColor.None,
	hasStars: item.hasStars,
	isDeleted: item.isDeleted,
	snippet: item.snippet,
	createdAt: item.createdAt,
	updatedAt: item.updatedAt,
	senderTrust: SenderTrust.Unknown,
});

/**
 * Plan the unique batch-fetch keys for a page of ThreadMessage rows.
 *
 * Splitting this out keeps the dedup logic testable without DynamoDB and
 * documents the contract: a page of N rows produces at most one BatchGet
 * for messages and one for addresses, no matter how many rows share the
 * same messageId / sender.
 *
 * `addressId` is derived deterministically from `(accountConfigId, fromEmail)`
 * via `AddressService.generateAddressId`, mirroring the write path in
 * `body-sync.ts`. Rows without a `fromEmail` (rare; sentinel/system rows)
 * contribute no addressId and fall back to `senderTrust: "unknown"`.
 */
export interface BatchPlan {
	messageIds: string[];
	addressIds: string[];
	addressIdByRow: Map<string, string>;
}

export const planBatchFetch = (rows: ThreadMessageItem[]): BatchPlan => {
	const messageIds = new Set<string>();
	const addressIds = new Set<string>();
	const addressIdByRow = new Map<string, string>();

	for (const row of rows) {
		messageIds.add(row.messageId);

		if (!row.fromEmail) continue;

		const addressId = AddressService.generateAddressId(
			row.accountConfigId,
			row.fromEmail,
		);
		addressIds.add(addressId);
		addressIdByRow.set(row.threadMessageId, addressId);
	}

	return {
		messageIds: [...messageIds],
		addressIds: [...addressIds],
		addressIdByRow,
	};
};

/**
 * Enrich a page of ThreadMessage rows with `category` (from the underlying
 * Message), `senderTrust` (derived from the From Address's flags map) and
 * `autoMoved` (projected from the Message's internal placement verdict, see
 * `deriveAutoMoved`).
 *
 * Two BatchGetItem calls per page, regardless of page size — see
 * `planBatchFetch` for the dedup contract.
 *
 * Missing rows fall back gracefully: `category` is omitted only when the
 * underlying Message row is absent (clients treat as `personal`); a present
 * Message with no stored category coalesces to `uncategorized` (RFC 032 Tier 2).
 * `senderTrust` defaults to `"unknown"`. `autoMoved` is omitted whenever the
 * move isn't a real, in-effect auto-move (or the Message row is absent).
 */
export const enrichThreadRows = async (
	rows: ThreadMessageItem[],
	client: EnrichClient,
	accountConfigId: string,
): Promise<ThreadMessageResponse[]> => {
	if (rows.length === 0) return [];

	const plan = planBatchFetch(rows);

	const [messages, addresses] = await Promise.all([
		plan.messageIds.length ? client.message.get(plan.messageIds) : [],
		plan.addressIds.length
			? client.address.getAddress(accountConfigId, plan.addressIds)
			: [],
	]);

	const categoryByMessageId = new Map(
		messages.map((m) => [
			m.messageId,
			m.category ?? MessageCategory.uncategorized,
		]),
	);
	const authenticityByMessageId = new Map(
		messages.map((m) => [m.messageId, m.authenticity]),
	);
	const autoMovedByMessageId = new Map(
		messages.map((m) => [m.messageId, deriveAutoMoved(m)]),
	);
	const trustByAddressId = new Map(
		addresses.map((a) => [a.addressId, deriveSenderTrust(a.flags)]),
	);

	return rows.map((row) => {
		const base = toResponse(row);
		const category = categoryByMessageId.get(row.messageId);
		const authenticity = authenticityByMessageId.get(row.messageId);
		const autoMoved = autoMovedByMessageId.get(row.messageId);
		const addressId = plan.addressIdByRow.get(row.threadMessageId);
		const senderTrust = addressId
			? (trustByAddressId.get(addressId) ?? SenderTrust.Unknown)
			: SenderTrust.Unknown;
		return {
			...base,
			...(category !== undefined ? { category } : {}),
			...(authenticity !== undefined ? { authenticity } : {}),
			...(autoMoved !== undefined ? { autoMoved } : {}),
			senderTrust,
		};
	});
};
