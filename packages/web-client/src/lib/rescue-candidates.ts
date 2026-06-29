import type {
	RemitImapSenderTrust,
	RemitImapThreadMessageResponse,
} from "@remit/api-http-client/types.gen.ts";

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
 * Returns true when a thread's sender is VIP or well-known with no confirmed
 * DKIM mismatch. Used only for telemetry (wasRescuable) when marking a message
 * as junk — it records whether the user moved a message that was previously
 * eligible for rescue under the client-side rule.
 *
 * Note: the backend rescue query uses dkimMismatch=false which also excludes
 * senders with no authenticity signal (undefined), unlike this predicate which
 * treats absent authenticity as eligible. The backend is stricter by design.
 */
export const isRescueCandidate = (
	thread: RemitImapThreadMessageResponse,
): boolean => {
	if (thread.senderTrust !== "vip" && thread.senderTrust !== "wellknown") {
		return false;
	}
	return thread.authenticity?.dkimMismatch !== true;
};
