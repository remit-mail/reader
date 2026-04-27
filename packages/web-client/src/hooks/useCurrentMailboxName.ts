import { mailboxOperationsListMailboxesOptions } from "@remit/api-http-client/@tanstack/react-query.gen.ts";
import type { RemitImapAccountResponse } from "@remit/api-http-client/types.gen.ts";
import { useQueries } from "@tanstack/react-query";
import { useLocation, useParams } from "@tanstack/react-router";
import { getMailboxDisplayName } from "@/lib/mailbox-order";

interface UseCurrentMailboxNameOptions {
	accounts: RemitImapAccountResponse[];
}

/**
 * Resolves a display label for the mailbox or pseudo-mailbox the user is
 * currently looking at — used by the mobile top bar so it reads e.g.
 * "Inbox" or "Outbox" instead of the static "Remit" branding.
 *
 * Priority:
 *   - `/mail/outbox` → "Outbox"
 *   - `/mail/$mailboxId` → display name from the mailbox query
 *   - everything else (e.g. `/mail` mid-redirect) → `null`
 *
 * Reuses the same `mailboxOperationsListMailboxesOptions` queries the
 * `MailSidebar` runs, so on warm cache (the sidebar is always mounted
 * on `/mail/*`) this is a free lookup.
 */
export const useCurrentMailboxName = ({
	accounts,
}: UseCurrentMailboxNameOptions): string | null => {
	const params = useParams({ strict: false });
	const location = useLocation();
	const mailboxId = (params as { mailboxId?: string }).mailboxId;

	const queries = useQueries({
		queries: accounts.map((account) => ({
			...mailboxOperationsListMailboxesOptions({
				path: { accountId: account.accountId },
			}),
			staleTime: Infinity,
		})),
	});

	if (location.pathname.startsWith("/mail/outbox")) return "Outbox";
	if (!mailboxId) return null;

	for (const query of queries) {
		const items = query.data?.items;
		if (!items) continue;
		const match = items.find((mailbox) => mailbox.mailboxId === mailboxId);
		if (match) return getMailboxDisplayName(match.fullPath);
	}

	return null;
};
