/**
 * Where a global compose has to land.
 *
 * The compose surface (`FullCompose`) is mounted by the mailbox route only, so
 * compose started from anywhere else — the daily brief, flagged, outbox — has
 * to carry the user to a mailbox first. The target is the first account's
 * inbox, falling back to its first mailbox.
 *
 * Both compose entry points use this: the top bar's button on desktop and the
 * mobile `ComposeFab`. One resolver, so the two surfaces cannot disagree about
 * which routes host the compose surface.
 */
import { mailboxOperationsListMailboxesOptions } from "@remit/api-http-client/@tanstack/react-query.gen.ts";
import type { RemitImapAccountResponse } from "@remit/api-http-client/types.gen.ts";
import { useQueries } from "@tanstack/react-query";
import { useLocation, useNavigate } from "@tanstack/react-router";
import { startTransition, useCallback } from "react";
import { useCompose } from "@/components/compose/ComposeProvider";
import { hostsComposeSurface } from "@/lib/compose-routes";
import { buildMailboxRoleMap } from "@/lib/folder-roles";

/**
 * The mailbox id a global compose should navigate to, or undefined if none is
 * known yet.
 *
 * Accounts resolve in order and an account whose mailbox query is still in
 * flight blocks rather than being skipped: skipping hands back a later
 * account's inbox and then silently swaps the target once the earlier query
 * settles.
 */
export function useComposeTargetMailboxId(
	accounts: RemitImapAccountResponse[],
): string | undefined {
	const mailboxQueries = useQueries({
		queries: accounts.map((account) => ({
			...mailboxOperationsListMailboxesOptions({
				path: { accountId: account.accountId },
			}),
			staleTime: Infinity,
		})),
	});

	for (const [index, account] of accounts.entries()) {
		const query = mailboxQueries[index];
		if (!query || query.isPending) return undefined;
		const mailboxes = query.data?.items ?? [];
		if (mailboxes.length === 0) continue;
		const roleMap = buildMailboxRoleMap(account.folderAppointments);
		const inbox = mailboxes.find(
			(mailbox) => roleMap.get(mailbox.mailboxId) === "inbox",
		);
		return (inbox ?? mailboxes[0])?.mailboxId;
	}
	return undefined;
}

/**
 * A compose action that works from every view: opens compose in place when the
 * current route already hosts the surface, otherwise navigates to the target
 * mailbox — compose state lives in `ComposeProvider` (mounted at the root), so
 * it survives the transition and the destination mounts straight into it.
 *
 * With no target resolved yet — a cold load whose mailbox queries have not
 * settled, or accounts with no mailboxes — the action does nothing. Opening
 * compose state first would leave it open with nothing rendering it, and it
 * would then pop up unprompted on the next navigation.
 */
export function useGlobalCompose(
	accounts: RemitImapAccountResponse[],
): () => void {
	const { openCompose } = useCompose();
	const navigate = useNavigate();
	const location = useLocation();
	const targetMailboxId = useComposeTargetMailboxId(accounts);

	return useCallback(() => {
		if (hostsComposeSurface(location.pathname)) {
			startTransition(() => {
				openCompose({ mode: "new" });
			});
			return;
		}
		if (!targetMailboxId) return;
		startTransition(() => {
			openCompose({ mode: "new" });
		});
		navigate({
			to: "/mail/$mailboxId",
			params: { mailboxId: targetMailboxId },
		});
	}, [openCompose, navigate, location.pathname, targetMailboxId]);
}
