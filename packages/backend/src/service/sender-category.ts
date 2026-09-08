import type { MessageCategoryValue } from "@remit/mailbox-service";
import { denormalizeMessageCategory } from "@remit/mailbox-service";
import type { RemitClient } from "./data-client.js";

/**
 * How much of a sender's already-classified mail one override reaches: the
 * newest 500 of their messages held in the local store. A back-apply is a
 * bounded recent batch, never the sender's whole history — the store-side
 * narrowing pages until this many MATCHES, so a quiet sender's mail is reached
 * however old it is, and a bulk sender's oldest mail is deliberately left as
 * the classifier decided it. The same constant the organize back-apply bounds
 * its match set with (`ORGANIZE_MATCH_LIMIT`), for the same reason.
 */
export const SENDER_CATEGORY_BACKAPPLY_LIMIT = 500;

export interface SenderCategoryBackApplyDeps {
	client: Pick<RemitClient, "message" | "threadMessage">;
}

export interface SenderCategoryBackApplyResult {
	matched: number;
	applied: number;
	failed: number;
}

/**
 * The sender's newest messages in the local store, bounded at `limit`, newest
 * first and deduplicated by messageId.
 *
 * The store evaluates `sender` as an accent- and case-insensitive SUBSTRING
 * over the From address and display name together, so it is a narrowing and
 * not the verdict: every page is refined here to an exact `fromEmail` match
 * before it counts. Paging continues until the cap fills or the store runs
 * out, which is what makes the bound a bound on the sender's messages rather
 * than on how far back the read reached (#459).
 */
const listSenderMessageIds = async (
	deps: SenderCategoryBackApplyDeps,
	accountConfigId: string,
	normalizedEmail: string,
	limit: number,
): Promise<string[]> => {
	const wanted = normalizedEmail.toLowerCase();
	const messageIds: string[] = [];
	const seen = new Set<string>();
	let continuationToken: string | undefined;

	do {
		const page = await deps.client.threadMessage.listByFieldTerms(
			accountConfigId,
			[{ field: "sender", contains: wanted }],
			{ limit, continuationToken, excludeDeleted: true },
		);
		for (const row of page.items) {
			if (row.fromEmail?.toLowerCase() !== wanted) continue;
			if (seen.has(row.messageId)) continue;
			seen.add(row.messageId);
			messageIds.push(row.messageId);
			if (messageIds.length >= limit) return messageIds;
		}
		continuationToken = page.continuationToken;
	} while (continuationToken);

	return messageIds;
};

/**
 * Back-apply a sender's `Address.flags.category` override to mail that was
 * already classified before the override was set (#415). Issue #299 gave the
 * override full effect on the sender's NEXT message only; this is the
 * retroactive half, deliberately bounded to
 * {@link SENDER_CATEGORY_BACKAPPLY_LIMIT}.
 *
 * This is the one path that intentionally rewrites an already-decided
 * `Message.category`, so it does not — and must not — reuse body sync's
 * `hasDecidedCategory` write-once guard. Its consistency story is that
 * `category` is a key attribute of no provisioned index: the DynamoDB LSI that
 * would have sorted on it was never provisioned and cannot be (#516), and the
 * filtered-mailbox read path is served by the SQL-only
 * `tm_by_mailbox_category_date` index, where an update simply moves the row.
 * What a rewrite can still break is the Message/ThreadMessage pair disagreeing
 * — the badge is served from the thread row and so is the category filter — so
 * both are written per message, thread rows first, and a redelivered job
 * re-runs the same idempotent writes.
 *
 * Nothing here touches placement: `category` is not an input to
 * `classifyPlacement`, so an override re-labels mail where it already sits and
 * files nothing. No remote mail-server state changes, which is why this is not
 * an IMAP mutation and does not take the mutator pattern.
 *
 * Per-message isolation, exactly as `applyOrganize` has it: one poisoned
 * message is counted as failed and the pass continues, so a single missing
 * thread row never costs the other 499 their re-label.
 */
export const backApplySenderCategory = async (
	deps: SenderCategoryBackApplyDeps,
	accountConfigId: string,
	normalizedEmail: string,
	category: MessageCategoryValue,
	limit: number = SENDER_CATEGORY_BACKAPPLY_LIMIT,
): Promise<SenderCategoryBackApplyResult> => {
	const messageIds = await listSenderMessageIds(
		deps,
		accountConfigId,
		normalizedEmail,
		limit,
	);

	const relabel = async (messageId: string): Promise<void> => {
		await denormalizeMessageCategory(
			{ threadMessageService: deps.client.threadMessage },
			accountConfigId,
			messageId,
			{ category },
		);
		await deps.client.message.update(messageId, { category });
	};

	let applied = 0;
	let failed = 0;
	for (const messageId of messageIds) {
		const ok = await relabel(messageId)
			.then(() => true)
			.catch(() => false);
		if (ok) {
			applied += 1;
		} else {
			failed += 1;
		}
	}

	return { matched: messageIds.length, applied, failed };
};
