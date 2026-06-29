import { threadOperationsSearchThreadsOptions } from "@remit/api-http-client/@tanstack/react-query.gen.ts";
import type { RescueCandidate } from "@remit/ui";
import { useQuery } from "@tanstack/react-query";
import { rescueCandidateReason } from "@/lib/rescue-candidates";

const TRUST_REASON = "We can verify this sender";

/**
 * Fetch rescue candidates from the backend for the given Junk mailbox.
 *
 * Filters by senderTrust=[vip,wellknown] and dkimMismatch=false. The
 * dkimMismatch=false filter excludes senders with no authenticity signal
 * (undefined), not just confirmed mismatches — this is intentional: it closes
 * the impersonation path where a spoofed trusted-sender From with no DKIM
 * would otherwise surface as a rescue candidate.
 *
 * Only fires when junkMailboxId is provided.
 */
export function useRescueCandidates(junkMailboxId: string | undefined): {
	candidates: RescueCandidate[];
} {
	const { data } = useQuery({
		...threadOperationsSearchThreadsOptions({
			path: { mailboxId: junkMailboxId ?? "" },
			query: {
				senderTrust: ["vip", "wellknown"],
				dkimMismatch: false,
				results: true,
				limit: 500,
			},
		}),
		enabled: !!junkMailboxId,
		staleTime: 60_000,
	});

	const candidates: RescueCandidate[] = (data?.items ?? []).map((thread) => ({
		id: thread.messageId,
		senderName: thread.fromName || thread.fromEmail || "Unknown sender",
		senderAddress: thread.fromEmail ?? "",
		subject: thread.subject || "(no subject)",
		snippet: thread.snippet ?? "",
		trustReason: TRUST_REASON,
		trustSubReason: rescueCandidateReason(thread.senderTrust),
		senderTrust: thread.senderTrust,
	}));

	return { candidates };
}
