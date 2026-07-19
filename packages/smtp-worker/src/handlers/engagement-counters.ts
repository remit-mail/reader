import type { OutboxMessageItem } from "@remit/data-ports";
import type { Logger } from "@remit/logger-lambda";
import type { EngagementCounterDeps, SendTenant } from "./send-message-core.js";

/**
 * Engagement counters for an outbound send.
 *
 * - Per recipient (To/Cc/Bcc): increment `outboundCount`, set `lastOutboundAt`
 * - Per recipient that also appears as the original sender of a stored
 *   message referenced by `In-Reply-To` or `References`: also increment
 *   `replyCount`, set `lastReplyAt`
 *
 * Counters use atomic `ADD`. Drift under at-least-once SQS is accepted
 * residual per EDD #232.
 */
export const writeEngagementCounters = async (
	outbox: OutboxMessageItem,
	tenant: SendTenant,
	deps: EngagementCounterDeps,
	log: Logger,
): Promise<void> => {
	const now = Date.now();
	const recipients = collectRecipients(outbox);
	if (recipients.length === 0) return;

	const recipientAddressIds = new Map<string, string>();
	for (const email of recipients) {
		const addressId = deps.resolveAddressId(tenant.accountConfigId, email);
		recipientAddressIds.set(email, addressId);
	}

	for (const addressId of recipientAddressIds.values()) {
		await deps.incrementOutboundCount(tenant.accountConfigId, addressId, now);
	}

	const replyTargets = await resolveReplyTargets(outbox, tenant, deps, log);
	for (const email of replyTargets) {
		const addressId = recipientAddressIds.get(email);
		if (!addressId) continue;
		await deps.incrementReplyCount(tenant.accountConfigId, addressId, now);
	}
};

const collectRecipients = (outbox: OutboxMessageItem): string[] => {
	const all = [
		...(outbox.toAddresses ?? []),
		...(outbox.ccAddresses ?? []),
		...(outbox.bccAddresses ?? []),
	];
	const seen = new Set<string>();
	const result: string[] = [];
	for (const raw of all) {
		const email = normalizeEmail(raw);
		if (!email) continue;
		if (seen.has(email)) continue;
		seen.add(email);
		result.push(email);
	}
	return result;
};

const normalizeEmail = (raw: string): string | null => {
	if (!raw) return null;
	const trimmed = raw.trim();
	if (trimmed === "") return null;
	const angle = trimmed.match(/<([^>]+)>/);
	const candidate = angle ? angle[1] : trimmed;
	if (!candidate.includes("@")) return null;
	return candidate.toLowerCase();
};

const resolveReplyTargets = async (
	outbox: OutboxMessageItem,
	tenant: SendTenant,
	deps: EngagementCounterDeps,
	log: Logger,
): Promise<Set<string>> => {
	const headerCandidates = collectReferenceHeaders(outbox);
	if (headerCandidates.length === 0) return new Set();

	const recipientSet = new Set(collectRecipients(outbox));

	const matched = new Set<string>();
	for (const header of headerCandidates) {
		for (const variant of headerVariants(header)) {
			const message = await deps.findMessageByHeader(tenant.accountId, variant);
			if (!message) continue;
			const fromEmail = await deps.getEnvelopeFromEmail(message.messageId);
			if (!fromEmail) continue;
			const normalized = fromEmail.toLowerCase();
			if (recipientSet.has(normalized)) {
				matched.add(normalized);
			}
			break;
		}
	}

	if (matched.size === 0) {
		log.debug?.(
			{ outboxMessageId: outbox.outboxMessageId },
			"No reply targets resolved from In-Reply-To/References",
		);
	}
	return matched;
};

const collectReferenceHeaders = (outbox: OutboxMessageItem): string[] => {
	const result: string[] = [];
	const seen = new Set<string>();
	const push = (raw: string | undefined): void => {
		if (!raw) return;
		const trimmed = raw.trim();
		if (trimmed === "" || seen.has(trimmed)) return;
		seen.add(trimmed);
		result.push(trimmed);
	};
	push(outbox.inReplyTo);
	for (const ref of outbox.references ?? []) push(ref);
	return result;
};

const headerVariants = (header: string): string[] => {
	const stripped = header.replace(/^<|>$/g, "");
	if (stripped === header) return [`<${header}>`, header];
	return [header, stripped];
};
