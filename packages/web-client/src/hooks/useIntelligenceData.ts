import {
	addressOperationsSearchAddressesOptions,
	semanticSearchOperationsSemanticSearchOptions,
} from "@remit/api-http-client/@tanstack/react-query.gen.ts";
import type {
	RemitImapAddressResponse,
	RemitImapThreadMessageResponse,
} from "@remit/api-http-client/types.gen.ts";
import type {
	AuthenticityIntel,
	IntelligenceData,
	MatchedChunk,
	SenderFlagsIntel,
	SimilarMessageIntel,
} from "@remit/ui";
import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { formatDate } from "@/lib/format";

/**
 * Format a creation timestamp as a human-readable "first seen" label.
 * - Today: "today"
 * - Otherwise: "Jan 2025"
 */
function formatFirstSeenLabel(createdAtMs: number): string {
	const d = new Date(createdAtMs);
	const now = new Date();
	if (d.toDateString() === now.toDateString()) return "today";
	return formatDate(d, { month: "short", year: "numeric" });
}

/**
 * Build sender flags from the address response.
 */
function buildSenderFlags(
	address: RemitImapAddressResponse | undefined,
): SenderFlagsIntel {
	if (!address?.flags) return {};
	return {
		vip: address.flags.vip?.value === true,
		muted: address.flags.muted?.value === true,
		blocked: address.flags.blocked?.value === true,
		unsubscribed: address.flags.unsubscribed?.value === true,
		autoArchive: address.flags.autoArchive?.value === true,
	};
}

/**
 * Build authenticity intel from the thread message's authenticity field.
 *
 * `similarCount` is the number of semantic-search lookalikes; the panel uses
 * it to render the "N similar messages" campaign-reveal CTA inside the
 * danger panel. Passed in because it is derived from the semantic-search
 * result, not the thread row.
 */
function buildAuthenticityIntel(
	thread: RemitImapThreadMessageResponse,
	similarCount: number,
): AuthenticityIntel {
	const auth = thread.authenticity;
	if (!auth) {
		// No authenticity signal → render as aligned (silent)
		return {
			verdict: "aligned",
			fromDomain: thread.fromEmail?.split("@")[1] ?? "",
			summary: "No DKIM signal available for this message.",
		};
	}
	if (!auth.dkimMismatch) {
		return {
			verdict: "aligned",
			fromDomain: auth.fromDomain,
			dkimDomain: auth.dkimDomain,
			summary: auth.dkimDomain
				? `DKIM signature aligns with ${auth.fromDomain}. Nothing unusual.`
				: "No DKIM mismatch detected.",
		};
	}
	// DKIM mismatch — build the phishing summary
	const fromDomain = auth.fromDomain;
	const dkimDomain = auth.dkimDomain;
	const claimedBrand =
		thread.fromName && thread.fromName !== thread.fromEmail
			? thread.fromName
			: undefined;
	const summary = claimedBrand
		? `The display name claims "${claimedBrand}", but the message was sent from ${dkimDomain ?? "an unknown domain"} — not ${fromDomain}. Real senders use their own domain.`
		: `This message was signed by ${dkimDomain ?? "an unknown domain"} but claims to be from ${fromDomain}. The signing domain does not match the sender domain.`;
	return {
		verdict: "mismatch",
		fromDomain,
		dkimDomain,
		claimedBrand,
		summary,
		// Surface the lookalike count so the panel renders the "N similar
		// messages" campaign-reveal button.
		similarCount: similarCount > 0 ? similarCount : undefined,
	};
}

export interface UseIntelligenceDataResult {
	data: IntelligenceData | null;
	/**
	 * True while similar-messages fetch is in flight. The rest of the data
	 * (sender, authenticity, category, flags) arrives synchronously from the
	 * already-loaded thread row.
	 */
	isSimilarLoading: boolean;
	/** Non-null when the similar-messages fetch failed. */
	similarError: unknown;
	/** Address id for the sender — needed for PATCH /addresses/{id} mutations. */
	addressId: string | undefined;
	/**
	 * Raw address response for the sender — forwarded to the quick-action
	 * mutation hooks so they can optimistically patch the cache.
	 */
	address: RemitImapAddressResponse | undefined;
}

/**
 * Maps a `RemitImapThreadMessageResponse` into `IntelligenceData` for the
 * `IntelligencePanel` component. Three data sources:
 *
 * 1. The thread row itself (already loaded) → sender basics, trust, authenticity, category.
 * 2. `GET /addresses/search?q=<email>` → address flags (VIP/muted/blocked/etc.)
 *    and first-seen timestamp. One round-trip per unique sender.
 * 3. `GET /search/semantic` → similar messages. Last to arrive; sidebar still
 *    renders if this fails.
 */
export function useIntelligenceData(
	thread: RemitImapThreadMessageResponse | null | undefined,
): UseIntelligenceDataResult {
	const senderEmail = thread?.fromEmail ?? null;
	const subject = thread?.subject ?? "";

	// --- Address lookup: flags + first-seen timestamp ---
	const { data: addressSearchResult } = useQuery({
		...addressOperationsSearchAddressesOptions({
			query: { q: senderEmail ?? "", limit: 1 },
		}),
		enabled: Boolean(senderEmail),
		staleTime: 30_000,
	});

	const address = addressSearchResult?.items?.[0];

	// --- Semantic search: similar messages ---
	const semanticQuery = [subject, senderEmail].filter(Boolean).join(" ");
	const {
		data: semanticResult,
		isLoading: isSimilarLoading,
		error: similarError,
	} = useQuery({
		...semanticSearchOperationsSemanticSearchOptions({
			query: { query: semanticQuery, limit: 5 },
		}),
		enabled: Boolean(thread && semanticQuery.length > 3),
		staleTime: 60_000,
		// Failure is acceptable — the sidebar degrades gracefully
		retry: 1,
	});

	const data = useMemo((): IntelligenceData | null => {
		if (!thread) return null;

		const similar: SimilarMessageIntel[] = (semanticResult?.items ?? [])
			// Exclude the current message itself
			.filter((r) => r.messageId !== thread.messageId)
			.map((r) => ({
				id: r.messageId,
				fromName: "",
				subject: "",
				timeLabel: "",
				matched: r.matchedChunkType as MatchedChunk,
			}));

		const sender = {
			name: thread.fromName ?? thread.fromEmail ?? "Unknown",
			email: thread.fromEmail ?? "",
			trust: thread.senderTrust,
			firstSeenLabel: address
				? formatFirstSeenLabel(address.createdAt)
				: "unknown",
			// Engagement counters (inboundCount/replyCount) are not yet exposed
			// on the address response — the Address entity has them but the API
			// response model omits them (tracked in a backend follow-up). Leave
			// them undefined so the panel suppresses the engagement clause
			// rather than printing a misleading "0 received · you've never
			// replied" next to an earned trust badge.
		};

		const authenticity = buildAuthenticityIntel(thread, similar.length);

		const category = {
			value: thread.category ?? "personal",
			overridden:
				address?.flags?.category?.value != null &&
				address.flags.category.value !== thread.category,
		};

		const flags = buildSenderFlags(address);

		return { sender, authenticity, category, flags, similar };
	}, [thread, address, semanticResult]);

	return {
		data,
		isSimilarLoading,
		similarError,
		addressId: address?.addressId,
		address,
	};
}
