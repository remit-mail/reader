import {
	addressOperationsSearchAddressesOptions,
	semanticSearchOperationsSemanticSearchOptions,
} from "@remit/api-http-client/@tanstack/react-query.gen.ts";
import type {
	RemitImapSenderTrust,
	RemitImapThreadMessageResponse,
} from "@remit/api-http-client/types.gen.ts";
import type { RescueCandidate } from "@remit/ui";
import { useQueries, useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import {
	assembleRescueCandidates,
	deriveSenderTrustFromFlags,
} from "@/lib/rescue-candidates";

/**
 * Upper bound on candidates pulled from the index. Comfortably above any
 * realistic count of authenticated mail sitting in a spam folder; the vector
 * backend caps a single query at its own page size, so this is the ceiling, not
 * a target.
 */
const RESCUE_SEARCH_LIMIT = 200;

/**
 * The search endpoint is a semantic ranker, so it needs a query string. Rescue
 * is not a semantic question — the metadata filters do the selecting — so we
 * pass a neutral coverage probe and rely on the filters to return the spam mail
 * that passed authentication.
 */
const RESCUE_COVERAGE_QUERY = "email";

interface UseRescueCandidatesParams {
	mailboxId: string;
	isSpamFolder: boolean;
	loadedThreads: RemitImapThreadMessageResponse[];
}

interface UseRescueCandidatesResult {
	candidates: RescueCandidate[];
	isLoading: boolean;
}

/**
 * Source the Rescue-from-Spam candidates from the search index rather than the
 * loaded thread pages. A single filtered query returns every spam-folder
 * message the provider flagged that still passed DMARC, so the banner shows an
 * exact total and true DMARC-Pass precision instead of a loaded-pages estimate.
 *
 * Trust is not indexed (it is derived at read time from Address flags), so it is
 * resolved here: loaded threads carry it inline; senders not on a loaded page
 * are looked up via `GET /addresses/search`. Candidates keep the existing gate —
 * senders we can verify (VIP or well-known).
 */
export function useRescueCandidates({
	mailboxId,
	isSpamFolder,
	loadedThreads,
}: UseRescueCandidatesParams): UseRescueCandidatesResult {
	const enabled = isSpamFolder && mailboxId.length > 0;

	const { data: searchData, isLoading: searchLoading } = useQuery({
		...semanticSearchOperationsSemanticSearchOptions({
			query: {
				query: RESCUE_COVERAGE_QUERY,
				mailboxId,
				providerSpamClassified: true,
				authResultDmarc: "Pass",
				dkimMismatch: false,
				limit: RESCUE_SEARCH_LIMIT,
			},
		}),
		enabled,
		staleTime: 60_000,
	});

	const hits = useMemo(() => searchData?.items ?? [], [searchData]);

	const threadsByMessageId = useMemo(
		() => new Map(loadedThreads.map((thread) => [thread.messageId, thread])),
		[loadedThreads],
	);

	const unresolvedEmails = useMemo(() => {
		const emails = new Set<string>();
		for (const hit of hits) {
			if (threadsByMessageId.has(hit.messageId)) continue;
			if (hit.fromEmail) emails.add(hit.fromEmail);
		}
		return [...emails];
	}, [hits, threadsByMessageId]);

	const addressQueries = useQueries({
		queries: unresolvedEmails.map((email) => ({
			...addressOperationsSearchAddressesOptions({
				query: { q: email, limit: 1 },
			}),
			enabled,
			staleTime: 30_000,
		})),
	});

	const trustByEmail = useMemo(() => {
		const map = new Map<string, RemitImapSenderTrust>();
		unresolvedEmails.forEach((email, index) => {
			const address = addressQueries[index]?.data?.items?.[0];
			map.set(email, deriveSenderTrustFromFlags(address?.flags));
		});
		return map;
	}, [unresolvedEmails, addressQueries]);

	const candidates = useMemo(
		() => assembleRescueCandidates(hits, threadsByMessageId, trustByEmail),
		[hits, threadsByMessageId, trustByEmail],
	);

	const addressLoading = addressQueries.some((query) => query.isLoading);

	return {
		candidates,
		isLoading: enabled && (searchLoading || addressLoading),
	};
}
