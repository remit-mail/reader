import type {
	RemitImapAddressResponse,
	RemitImapSenderTrust,
	RemitImapThreadMessageResponse,
} from "@remit/api-http-client/types.gen.ts";
import type { RescueCandidate } from "@remit/ui";

/**
 * Headline chip on every rescue candidate. Constant: the row already explains
 * the specific reason underneath, in plain words.
 */
const TRUST_REASON = "We can verify this sender";

/**
 * Plain-language reason a message is safe to rescue, derived from the sender's
 * trust tier. Never DKIM/SPF jargon — the user only sees why we trust them.
 */
export const rescueCandidateReason = (
	senderTrust: RemitImapSenderTrust,
): string => {
	if (senderTrust === "vip") return "A sender you know";
	if (senderTrust === "wellknown") return "You've emailed them before";
	return "Passed authentication";
};

/**
 * Trust tiers we surface as rescue candidates: senders we can vouch for.
 */
export const isRescuableTrust = (
	senderTrust: RemitImapSenderTrust,
): senderTrust is "vip" | "wellknown" =>
	senderTrust === "vip" || senderTrust === "wellknown";

/**
 * Resolve a sender's trust tier from its Address flags — the same mapping the
 * backend applies (`deriveSenderTrust`). Used for spam-folder senders not in the
 * loaded thread pages, looked up via `GET /addresses/search`.
 */
export const deriveSenderTrustFromFlags = (
	flags: RemitImapAddressResponse["flags"],
): RemitImapSenderTrust => {
	if (flags?.vip?.value === true) return "vip";
	if (flags?.wellknown?.value === true) return "wellknown";
	return "unknown";
};

/**
 * The fields a rescue candidate is built from, regardless of source (a loaded
 * thread row or a search-index hit). Trust is resolved by the caller.
 */
export interface RescueCandidateSource {
	messageId: string;
	senderName: string;
	senderAddress: string;
	subject: string;
	snippet: string;
	senderTrust: RemitImapSenderTrust;
}

/**
 * Shape a resolved source into the kit's `RescueCandidate`. The trust gate is
 * the caller's responsibility.
 */
export const buildRescueCandidate = (
	source: RescueCandidateSource,
): RescueCandidate => ({
	id: source.messageId,
	senderName: source.senderName || source.senderAddress || "Unknown sender",
	senderAddress: source.senderAddress,
	subject: source.subject || "(no subject)",
	snippet: source.snippet,
	trustReason: TRUST_REASON,
	trustSubReason: rescueCandidateReason(source.senderTrust),
	senderTrust: source.senderTrust,
});

/**
 * A spam-folder message returned by the search index. Carries the denormalized
 * sender (for trust resolution + display) but not the trust tier itself, which
 * is resolved at read time.
 */
export interface RescueSearchHit {
	messageId: string;
	fromName?: string;
	fromEmail?: string;
	subject?: string;
}

/**
 * Merge the search-index hits with resolved trust into the suspected-safe
 * candidate list. Trust comes from a loaded thread row when the message is on a
 * loaded page; otherwise from the address lookup keyed by sender email. Keeps
 * only senders we can verify (VIP or well-known), so the count is the exact
 * total of trusted, auth-passed spam.
 */
export const assembleRescueCandidates = (
	hits: RescueSearchHit[],
	loadedThreadsByMessageId: Map<string, RemitImapThreadMessageResponse>,
	trustByEmail: Map<string, RemitImapSenderTrust>,
): RescueCandidate[] => {
	const out: RescueCandidate[] = [];
	for (const hit of hits) {
		const loaded = loadedThreadsByMessageId.get(hit.messageId);
		const senderTrust = loaded
			? loaded.senderTrust
			: hit.fromEmail
				? (trustByEmail.get(hit.fromEmail) ?? "unknown")
				: "unknown";
		if (!isRescuableTrust(senderTrust)) continue;
		out.push(
			buildRescueCandidate({
				messageId: hit.messageId,
				senderName: hit.fromName || loaded?.fromName || "",
				senderAddress: hit.fromEmail || loaded?.fromEmail || "",
				subject: hit.subject || loaded?.subject || "",
				snippet: loaded?.snippet ?? "",
				senderTrust,
			}),
		);
	}
	return out;
};

/**
 * A message in the Spam folder is a rescue candidate when its sender is one we
 * can verify (VIP or well-known) and there's no DKIM-mismatch signal against
 * it. Absent authenticity means no negative signal, so it stays eligible.
 */
export const isRescueCandidate = (
	thread: RemitImapThreadMessageResponse,
): boolean => {
	if (!isRescuableTrust(thread.senderTrust)) return false;
	return thread.authenticity?.dkimMismatch !== true;
};

/**
 * Map the loaded Spam folder threads to the suspected-safe rescue candidates.
 * Returns an empty list off the Spam folder, so callers can call it
 * unconditionally. The count is over the loaded pages only — the list has no
 * total.
 */
export const buildRescueCandidates = (
	threads: RemitImapThreadMessageResponse[],
	isSpamFolder: boolean,
): RescueCandidate[] => {
	if (!isSpamFolder) return [];
	return threads.filter(isRescueCandidate).map((thread) =>
		buildRescueCandidate({
			messageId: thread.messageId,
			senderName: thread.fromName || thread.fromEmail || "Unknown sender",
			senderAddress: thread.fromEmail ?? "",
			subject: thread.subject || "(no subject)",
			snippet: thread.snippet ?? "",
			senderTrust: thread.senderTrust,
		}),
	);
};
