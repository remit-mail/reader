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
	SenderIntel,
	SimilarMessageIntel,
} from "@remit/ui";
import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { isFatalServerError } from "@/lib/error-classifier";
import { formatDate, formatEmailDate } from "@/lib/format";

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
 * A sender address we cannot read: empty, missing the `@`, or whose domain
 * part carries no dot (catches placeholders like `missing_domain` and other
 * junk). Structural — never a hard-coded literal.
 */
export function isSenderAddressUnverifiable(
	fromEmail: string | undefined,
): boolean {
	if (!fromEmail) return true;
	const [, domain] = fromEmail.split("@");
	if (!domain) return true;
	return !domain.includes(".");
}

const NO_SIGNAL_SUMMARY =
	"We can't verify the sender of this email, which could mean it's from an insecure source.";

const UNREADABLE_SENDER_SUMMARY =
	"We couldn't read this sender's address, so we can't confirm who really sent this message.";

/**
 * Build sender intel from the thread message and address lookup.
 *
 * Engagement counters (`inboundCount`/`replyCount`) are passed through
 * as-is from the address response. When absent (`undefined`) they remain
 * `undefined` so the `SenderCard` engagement clause is suppressed rather
 * than rendering a misleading "0 received" next to an earned trust badge.
 */
export function buildSenderIntel(
	thread: RemitImapThreadMessageResponse,
	address: RemitImapAddressResponse | undefined,
): SenderIntel {
	return {
		name: thread.fromName ?? thread.fromEmail ?? "Unknown",
		email: thread.fromEmail ?? "",
		trust: thread.senderTrust,
		firstSeenLabel: address
			? formatFirstSeenLabel(address.createdAt)
			: "unknown",
		// Pass counters through as-is. undefined stays undefined so the panel
		// suppresses the engagement clause when data is absent.
		inboundCount: address?.inboundCount,
		replyCount: address?.replyCount,
		addressUnverified: isSenderAddressUnverifiable(thread.fromEmail),
	};
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
export function buildAuthenticityIntel(
	thread: RemitImapThreadMessageResponse,
	similarCount: number,
): AuthenticityIntel {
	const surfacedSimilar = similarCount > 0 ? similarCount : undefined;

	if (isSenderAddressUnverifiable(thread.fromEmail)) {
		return {
			verdict: "mismatch",
			fromDomain: "",
			addressUnreadable: true,
			summary: UNREADABLE_SENDER_SUMMARY,
			similarCount: surfacedSimilar,
		};
	}

	const auth = thread.authenticity;
	if (!auth) {
		return {
			verdict: "caution",
			fromDomain: thread.fromEmail?.split("@")[1] ?? "",
			summary: NO_SIGNAL_SUMMARY,
		};
	}
	if (!auth.dkimMismatch) {
		return {
			verdict: "aligned",
			fromDomain: auth.fromDomain,
			dkimDomain: auth.dkimDomain,
			summary: auth.dkimDomain
				? `We verified this message was really sent by ${auth.fromDomain}.`
				: `Nothing looks unusual about this sender.`,
		};
	}

	const fromDomain = auth.fromDomain;
	const dkimDomain = auth.dkimDomain;
	const claimedBrand =
		thread.fromName && thread.fromName !== thread.fromEmail
			? thread.fromName
			: undefined;
	const summary = claimedBrand
		? `The display name claims "${claimedBrand}", but this message was actually sent from ${dkimDomain ?? "another sender"} — not ${fromDomain}. Real senders use their own address.`
		: `This message claims to be from ${fromDomain}, but it was actually sent from ${dkimDomain ?? "a different sender"}.`;
	return {
		verdict: "mismatch",
		fromDomain,
		dkimDomain,
		claimedBrand,
		summary,
		// Surface the lookalike count so the panel renders the "N similar
		// messages" campaign-reveal button.
		similarCount: surfacedSimilar,
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
	/**
	 * True when the similar-messages failure is a fatal first-party 5xx. The
	 * global escalation overlay handles it; the panel must NOT degrade it to the
	 * benign grey "Similarity search unavailable" label. A soft (non-fatal)
	 * error or an empty result keeps the panel quiet.
	 */
	similarErrorIsFatal: boolean;
	/**
	 * True when the address lookup failed with a fatal first-party 5xx. The panel
	 * must not silently render the sender's flags (VIP/muted/blocked) as absent —
	 * that misrepresents the sender's real state. Escalation covers it.
	 */
	addressErrorIsFatal: boolean;
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
	const { data: addressSearchResult, error: addressError } = useQuery({
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
		// A non-fatal failure (e.g. 404, no index yet) is acceptable — the sidebar
		// degrades gracefully. A 5xx is NOT acceptable: it escalates globally and
		// the panel must not present it as a benign "unavailable" state.
		retry: 1,
	});

	const data = useMemo((): IntelligenceData | null => {
		if (!thread) return null;

		const similar: SimilarMessageIntel[] = (semanticResult?.items ?? [])
			// Exclude the current message itself
			.filter((r) => r.messageId !== thread.messageId)
			.map((r) => ({
				id: r.messageId,
				fromName: r.fromName ?? "",
				subject: r.subject ?? "(No subject)",
				timeLabel: r.sentDate != null ? formatEmailDate(r.sentDate * 1000) : "",
				matched: r.matchedChunkType as MatchedChunk,
			}));

		const sender = buildSenderIntel(thread, address);

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
		similarErrorIsFatal: isFatalServerError(similarError),
		addressErrorIsFatal: isFatalServerError(addressError),
		addressId: address?.addressId,
		address,
	};
}
