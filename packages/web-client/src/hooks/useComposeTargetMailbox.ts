/**
 * Where a compose started off a mailbox route has to land.
 *
 * `FullCompose` is mounted by the mailbox route only, so compose started from
 * the daily brief, flagged or the outbox has to carry the user to a mailbox
 * first. The target is the first account's inbox, falling back to its first
 * mailbox.
 */
import { mailboxOperationsListMailboxesOptions } from "@remit/api-http-client/@tanstack/react-query.gen.ts";
import type { RemitImapAccountResponse } from "@remit/api-http-client/types.gen.ts";
import { useQueries } from "@tanstack/react-query";
import { buildMailboxRoleMap } from "@/lib/folder-roles";

/**
 * The mailbox id to land on, or undefined while none is known.
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
