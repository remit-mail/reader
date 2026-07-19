/**
 * Where a global compose has to land.
 *
 * The compose surface (`FullCompose`) is mounted by the mailbox route only, so
 * compose started from anywhere else — the daily brief, flagged, outbox — has
 * to carry the user to a mailbox first. The target is the first account's
 * inbox, falling back to its first mailbox.
 */
import { mailboxOperationsListMailboxesOptions } from "@remit/api-http-client/@tanstack/react-query.gen.ts";
import type { RemitImapAccountResponse } from "@remit/api-http-client/types.gen.ts";
import { useQueries } from "@tanstack/react-query";
import { useLocation, useNavigate } from "@tanstack/react-router";
import { startTransition, useCallback } from "react";
import { useCompose } from "@/components/compose/ComposeProvider";
import { buildMailboxRoleMap } from "@/lib/folder-roles";

/**
 * True for `/mail/<id>` where `<id>` is a real mailbox — the route that hosts
 * the compose surface. `outbox` and `flagged` are virtual views without one.
 */
export const hostsComposeSurface = (pathname: string): boolean =>
	/^\/mail\/(?!outbox\b|flagged\b)[^/?]+/.test(pathname);

/** The mailbox id a global compose should navigate to, or undefined if none. */
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
		const mailboxes = mailboxQueries[index]?.data?.items ?? [];
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
 */
export function useGlobalCompose(
	accounts: RemitImapAccountResponse[],
): () => void {
	const { openCompose } = useCompose();
	const navigate = useNavigate();
	const location = useLocation();
	const targetMailboxId = useComposeTargetMailboxId(accounts);

	return useCallback(() => {
		startTransition(() => {
			openCompose({ mode: "new" });
		});
		if (hostsComposeSurface(location.pathname)) return;
		if (!targetMailboxId) return;
		navigate({
			to: "/mail/$mailboxId",
			params: { mailboxId: targetMailboxId },
		});
	}, [openCompose, navigate, location.pathname, targetMailboxId]);
}
