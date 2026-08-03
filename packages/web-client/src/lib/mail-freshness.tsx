import { syncOperationsGetSyncStatusOptions } from "@remit/api-http-client/@tanstack/react-query.gen.ts";
import type { RemitImapMailboxSyncProgress } from "@remit/api-http-client/types.gen.ts";
import type { NavMailboxRole } from "@remit/ui";
import { useQueries, useQueryClient } from "@tanstack/react-query";
import {
	createContext,
	type ReactNode,
	useCallback,
	useContext,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import { useMailContext } from "@/lib/mail-context";
import type { ResultFolderIndex } from "@/lib/result-folder";

/**
 * How often the background poll re-reads each open account's sync status.
 * `getSyncStatus` is a DDB read with no IMAP call and no queue write (see
 * typespec Sync Operations), so this is the cheap side of the refresh
 * feature — the once-a-minute check that decides whether anything is worth
 * surfacing, never a refetch of the mailbox or brief content itself.
 */
export const FRESHNESS_POLL_MS = 60_000;

/**
 * Roles whose own total growing is the user's doing, not an arrival: sending
 * grows Sent, deleting or archiving grows Trash/Archive, and a Drafts count is
 * autosaves. Counting any of these as "new mail" would light the dot on a
 * message the user just moved themselves. Junk is kept in — spam is still an
 * arrival, just an unwanted one — and a mailbox with no resolved role (a
 * custom folder, or one a filter files mail into directly) is never excluded.
 */
const EXCLUDED_GROWTH_ROLES: ReadonlySet<NavMailboxRole> = new Set([
	"sent",
	"drafts",
	"trash",
	"archive",
]);

type MailboxTotals = ReadonlyMap<string, number>;

export const totalsFrom = (
	mailboxes: readonly RemitImapMailboxSyncProgress[],
	resultFolderIndex: ResultFolderIndex,
): MailboxTotals => {
	const totals = new Map<string, number>();
	for (const mailbox of mailboxes) {
		const role = resultFolderIndex.get(mailbox.mailboxId)?.role;
		if (role && EXCLUDED_GROWTH_ROLES.has(role)) continue;
		totals.set(mailbox.mailboxId, mailbox.messagesTotal);
	}
	return totals;
};

/**
 * Whether any mailbox's message total grew since the baseline. Pure so the
 * "did mail arrive" call is unit-testable without a DOM or a QueryClient. A
 * mailbox missing from the baseline (new folder, first-ever reading) counts
 * from zero rather than being skipped, so mail landing in a folder created
 * since the last look still counts as an arrival.
 */
export const hasGrown = (
	baseline: MailboxTotals,
	current: MailboxTotals,
): boolean => {
	for (const [mailboxId, total] of current) {
		if (total > (baseline.get(mailboxId) ?? 0)) return true;
	}
	return false;
};

interface MailFreshnessContextValue {
	/** True once any of these accounts has grown since it was last acknowledged. */
	hasNewMail: (accountIds: readonly string[]) => boolean;
	/** Clears the flag for these accounts and re-baselines them from whatever
	 * is currently cached — called once a refresh has shown the user current
	 * data for them. */
	acknowledge: (accountIds: readonly string[]) => void;
}

const MailFreshnessContext = createContext<MailFreshnessContextValue | null>(
	null,
);

export const useMailFreshness = (): MailFreshnessContextValue => {
	const ctx = useContext(MailFreshnessContext);
	if (!ctx) {
		throw new Error(
			"useMailFreshness must be used inside <MailFreshnessProvider>",
		);
	}
	return ctx;
};

interface MailFreshnessProviderProps {
	accountIds: readonly string[];
	children: ReactNode;
}

/**
 * Watches every open account's sync status once a minute and flags which
 * accounts have grown since they were last shown to the user (#582 clause
 * 4). The flag is sticky until acknowledged — a background tick never
 * invalidates or reorders anything on its own, it only lights the dot on
 * whichever `RefreshButton` reads this context, leaving the choice to load
 * it with the user.
 */
export function MailFreshnessProvider({
	accountIds,
	children,
}: MailFreshnessProviderProps) {
	const queryClient = useQueryClient();
	const { resultFolderIndex } = useMailContext();
	const baselineRef = useRef(new Map<string, MailboxTotals>());
	const seededRef = useRef(new Set<string>());
	const [newMail, setNewMail] = useState<ReadonlySet<string>>(new Set());

	const queries = useQueries({
		queries: accountIds.map((accountId) => ({
			...syncOperationsGetSyncStatusOptions({ path: { accountId } }),
			refetchInterval: FRESHNESS_POLL_MS,
			staleTime: FRESHNESS_POLL_MS,
			meta: { softError: true },
		})),
	});
	const updatedKey = queries.map((query) => query.dataUpdatedAt).join(",");
	const accountIdsKey = accountIds.join(",");

	// biome-ignore lint/correctness/useExhaustiveDependencies: updatedKey is the real trigger (each query's own dataUpdatedAt); queries and resultFolderIndex are read fresh each run, not values this effect reacts to on their own.
	useEffect(() => {
		let changed = false;
		const next = new Set(newMail);
		accountIds.forEach((accountId, index) => {
			const data = queries[index]?.data;
			if (!data) return;
			const current = totalsFrom(data.mailboxes ?? [], resultFolderIndex);
			if (!seededRef.current.has(accountId)) {
				seededRef.current.add(accountId);
				baselineRef.current.set(accountId, current);
				return;
			}
			if (next.has(accountId)) return;
			const baseline = baselineRef.current.get(accountId) ?? new Map();
			if (hasGrown(baseline, current)) {
				next.add(accountId);
				changed = true;
			}
		});
		if (changed) setNewMail(next);
	}, [accountIdsKey, updatedKey]);

	const hasNewMail = useCallback(
		(ids: readonly string[]) => ids.some((id) => newMail.has(id)),
		[newMail],
	);

	const acknowledge = useCallback(
		(ids: readonly string[]) => {
			setNewMail((prev) => {
				if (ids.every((id) => !prev.has(id))) return prev;
				const next = new Set(prev);
				for (const id of ids) next.delete(id);
				return next;
			});
			for (const accountId of ids) {
				// `useRefreshControl` reads and writes this exact query key through
				// `queryClient.fetchQuery` as its own wait settles, so this is the
				// data that refresh just showed the user — never a round-old
				// cached reading from this provider's own 60s interval.
				const data = queryClient.getQueryData(
					syncOperationsGetSyncStatusOptions({ path: { accountId } }).queryKey,
				) as
					| { mailboxes?: readonly RemitImapMailboxSyncProgress[] }
					| undefined;
				baselineRef.current.set(
					accountId,
					totalsFrom(data?.mailboxes ?? [], resultFolderIndex),
				);
				seededRef.current.add(accountId);
			}
		},
		[queryClient, resultFolderIndex],
	);

	// The sync-status queries update on their own cadence (this poll's 60s, or
	// every 3s while `useInitialSyncProgress` shares the same key during an
	// initial sync) — memoized so a tick that changes nothing about the
	// flag set does not re-render every consumer down the tree.
	const value = useMemo(
		() => ({ hasNewMail, acknowledge }),
		[hasNewMail, acknowledge],
	);

	return (
		<MailFreshnessContext.Provider value={value}>
			{children}
		</MailFreshnessContext.Provider>
	);
}
