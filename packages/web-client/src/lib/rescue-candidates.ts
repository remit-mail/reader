import type {
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
 * A message in the Spam folder is a rescue candidate when its sender is one we
 * can verify (VIP or well-known) and there's no DKIM-mismatch signal against
 * it. Absent authenticity means no negative signal, so it stays eligible.
 */
export const isRescueCandidate = (
	thread: RemitImapThreadMessageResponse,
): boolean => {
	if (thread.senderTrust !== "vip" && thread.senderTrust !== "wellknown") {
		return false;
	}
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
	return threads.filter(isRescueCandidate).map((thread) => ({
		id: thread.messageId,
		senderName: thread.fromName || thread.fromEmail || "Unknown sender",
		senderAddress: thread.fromEmail ?? "",
		subject: thread.subject || "(no subject)",
		snippet: thread.snippet ?? "",
		trustReason: TRUST_REASON,
		trustSubReason: rescueCandidateReason(thread.senderTrust),
		senderTrust: thread.senderTrust,
	}));
};
