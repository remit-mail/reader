import type { ThreadMessageResponse } from "@remit/api-openapi-types";
import type {
	AddressItem,
	LabelItem,
	MessageItem,
	MessageLabelItem,
	ThreadMessageItem,
} from "@remit/data-ports";
import { deriveAddressId } from "@remit/data-ports/id";
import {
	MessageStatus,
	MessageSyncStatus,
	SenderTrust,
	StarColor,
} from "@remit/domain-enums";
import { deriveAutoMoved } from "./autoMoved.js";
import { deriveMuted } from "./deriveMuted.js";
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
	messageLabel: {
		listByMessageIds(messageIds: string[]): Promise<MessageLabelItem[]>;
	};
	label: {
		listByAccountConfig(accountConfigId: string): Promise<LabelItem[]>;
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
	category: item.category,
	createdAt: item.createdAt,
	updatedAt: item.updatedAt,
	senderTrust: SenderTrust.Unknown,
	muted: false,
	status: MessageStatus.active,
	syncStatus: MessageSyncStatus.pending,
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
 * via `deriveAddressId`, mirroring the write path in
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

		const addressId = deriveAddressId(row.accountConfigId, row.fromEmail);
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
 * Enrich a page of ThreadMessage rows with `senderTrust` and `muted` (both
 * derived from the From Address's flags map), `authenticity`, `autoMoved` and
 * `spamReport`, and the `status`/`syncStatus` pair an IMAP mutation leaves
 * behind (all projected straight from the Message row — no ThreadMessage
 * column of their own, see `deriveAutoMoved`). `toResponse` seeds that pair
 * with the ordinary inbound values, which the projection then overwrites; a
 * ThreadMessage row whose Message row is missing from the batch is broken in a
 * way this read path cannot report, and claiming a mutation it has no evidence
 * of would be worse.
 *
 * `category` is not enriched: it is denormalized onto the ThreadMessage row
 * (shared with `Message.category`'s write-once value, see body-sync.ts) and
 * carried straight through by `toResponse`, so the value a client renders is
 * the value the category filter matched.
 *
 * Two BatchGetItem calls per page, regardless of page size — see
 * `planBatchFetch` for the dedup contract.
 *
 * Missing rows fall back gracefully: `senderTrust` defaults to `"unknown"`,
 * `muted` defaults to `false`, and `authenticity` / `autoMoved` are omitted
 * whenever the Message row is absent or the move isn't a real, in-effect
 * auto-move.
 *
 * Not annotated `Promise<ThreadMessageResponse[]>`: `labels` is a new field on
 * it in this same PR, and that package publishes separately from this repo —
 * an explicit annotation here would contextually type the literal below
 * against the currently-*published* shape (which lacks `labels`) and fail
 * `check-consumer-typecheck`/`release:dry-run`. Callers assign the (wider,
 * inferred) result into an already-typed `ThreadMessageResponse[]` property,
 * which is a plain assignability check, not an excess-property one.
 */
export const enrichThreadRows = async (
	rows: ThreadMessageItem[],
	client: EnrichClient,
	accountConfigId: string,
) => {
	if (rows.length === 0) return [];

	const plan = planBatchFetch(rows);

	const [messages, addresses, messageLabels, labels] = await Promise.all([
		plan.messageIds.length ? client.message.get(plan.messageIds) : [],
		plan.addressIds.length
			? client.address.getAddress(accountConfigId, plan.addressIds)
			: [],
		client.messageLabel.listByMessageIds(plan.messageIds),
		client.label.listByAccountConfig(accountConfigId),
	]);

	const labelById = new Map(labels.map((label) => [label.labelId, label]));
	const labelsByMessageId = new Map<
		string,
		{ labelId: string; name: string; color: LabelItem["color"] }[]
	>();
	for (const messageLabel of messageLabels) {
		const label = labelById.get(messageLabel.labelId);
		if (!label) continue;
		const entry = {
			labelId: label.labelId,
			name: label.name,
			color: label.color,
		};
		const existing = labelsByMessageId.get(messageLabel.messageId);
		if (existing) {
			existing.push(entry);
		} else {
			labelsByMessageId.set(messageLabel.messageId, [entry]);
		}
	}

	const authenticityByMessageId = new Map(
		messages.map((m) => [m.messageId, m.authenticity]),
	);
	const autoMovedByMessageId = new Map(
		messages.map((m) => [m.messageId, deriveAutoMoved(m)]),
	);
	const spamReportByMessageId = new Map(
		messages.map((m) => [m.messageId, m.spamReport]),
	);
	const settlementByMessageId = new Map(
		messages.map((m) => [
			m.messageId,
			{ status: m.status, syncStatus: m.syncStatus },
		]),
	);
	const trustByAddressId = new Map(
		addresses.map((a) => [a.addressId, deriveSenderTrust(a.flags)]),
	);
	const mutedByAddressId = new Map(
		addresses.map((a) => [a.addressId, deriveMuted(a.flags)]),
	);

	return rows.map((row) => {
		const base = toResponse(row);
		const authenticity = authenticityByMessageId.get(row.messageId);
		const autoMoved = autoMovedByMessageId.get(row.messageId);
		const spamReport = spamReportByMessageId.get(row.messageId);
		const addressId = plan.addressIdByRow.get(row.threadMessageId);
		const senderTrust = addressId
			? (trustByAddressId.get(addressId) ?? SenderTrust.Unknown)
			: SenderTrust.Unknown;
		const muted = addressId
			? (mutedByAddressId.get(addressId) ?? false)
			: false;
		const labels = labelsByMessageId.get(row.messageId);
		const settlement = settlementByMessageId.get(row.messageId);
		return {
			...base,
			...(settlement ?? {}),
			...(authenticity !== undefined ? { authenticity } : {}),
			...(autoMoved !== undefined ? { autoMoved } : {}),
			...(labels !== undefined ? { labels } : {}),
			...(spamReport !== undefined ? { spamReport } : {}),
			senderTrust,
			muted,
		};
	});
};
