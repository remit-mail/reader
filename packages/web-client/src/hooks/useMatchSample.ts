import {
	messageOperationsDescribeMessageOptions,
	threadOperationsSearchThreadsOptions,
} from "@remit/api-http-client/@tanstack/react-query.gen.ts";
import type {
	RemitImapDescribeMessageResponse,
	RemitImapThreadMessageResponse,
} from "@remit/api-http-client/types.gen.ts";
import { senderLabel, type WizardMessage } from "@remit/ui";
import { useQueries, useQuery } from "@tanstack/react-query";
import type { EscalationSearchQuery } from "@/hooks/useEscalatedActions";
import { formatEmailDate } from "@/lib/format";

/**
 * The members of a match, read from the server that matched them.
 *
 * A widened match reaches mail the list never loaded, so these rows cannot come
 * from the browser's own cache: an intersection with whatever happens to be
 * loaded shows a handful of rows, or none, beside a server count of hundreds —
 * which reads as "this matches nothing", the one conclusion #477 3.5 exists to
 * prevent. The ids the count was counted over are the match, and the server
 * describes each of them.
 *
 * Bounded to the first {@link SAMPLE_LIMIT}: the screen shows a sample in its
 * own scrolling region and states the total beside it, so describing the whole
 * match would be requests nobody reads.
 */
export const SAMPLE_LIMIT = 12;

export interface MatchSample {
	messages: WizardMessage[];
	/** No rows yet because they are still arriving, which is not "no rows". */
	isPending: boolean;
}

const toWizardMessage = (
	described: RemitImapDescribeMessageResponse,
): WizardMessage => {
	const { envelope } = described;
	const from = envelope.from[0];
	return {
		id: envelope.messageId,
		sender: from
			? senderLabel({
					normalizedEmail: from.normalizedEmail,
					displayName: from.displayName,
				})
			: "Unknown",
		subject: envelope.subject ?? "(No subject)",
		date: formatEmailDate(envelope.date),
	};
};

/**
 * The members of an escalated predicate's match (#508). The predicate is the
 * search the list is showing, so the search endpoint that resolved it is what
 * names its members — one bounded request rather than the browser's own loaded
 * rows, which stop at the page the list happens to have reached.
 */
export const useSearchMatchSample = (
	mailboxId: string | undefined,
	query: EscalationSearchQuery | undefined,
): MatchSample => {
	const enabled = mailboxId !== undefined && query !== undefined;
	const { data, isLoading } = useQuery({
		...threadOperationsSearchThreadsOptions({
			path: { mailboxId: mailboxId ?? "" },
			query: { ...query, limit: SAMPLE_LIMIT },
		}),
		enabled,
		staleTime: 30_000,
	});
	return {
		messages: (data?.items ?? []).map(toSearchWizardMessage),
		isPending: enabled && isLoading,
	};
};

const toSearchWizardMessage = (
	row: RemitImapThreadMessageResponse,
): WizardMessage => ({
	id: row.messageId,
	sender: row.fromName || row.fromEmail || "Unknown",
	subject: row.subject ?? "(No subject)",
	date: formatEmailDate(row.sentDate),
});

export const useMatchSample = (messageIds: readonly string[]): MatchSample =>
	useQueries({
		queries: messageIds.slice(0, SAMPLE_LIMIT).map((messageId) => ({
			...messageOperationsDescribeMessageOptions({ path: { messageId } }),
			staleTime: Number.POSITIVE_INFINITY,
		})),
		combine: (results) => ({
			messages: results
				.map((result) => result.data)
				.filter(
					(data): data is RemitImapDescribeMessageResponse =>
						data !== undefined,
				)
				.map(toWizardMessage),
			isPending: results.some((result) => result.isPending),
		}),
	});
