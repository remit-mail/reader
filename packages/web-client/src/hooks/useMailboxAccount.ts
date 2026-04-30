import {
	configOperationsGetConfigOptions,
	mailboxOperationsListMailboxesOptions,
} from "@remit/api-http-client/@tanstack/react-query.gen.ts";
import { useQueries, useQuery } from "@tanstack/react-query";
import { useMemo } from "react";

interface MailboxAccountResolution {
	accountId: string | undefined;
	isLoading: boolean;
}

/**
 * Resolve the owning account for a single mailbox by id.
 *
 * The mailbox-list query is keyed by accountId, so we fan out to every
 * configured account's mailbox list (cached forever, see sidebar) and find
 * the one containing this mailboxId. Returns `accountId: undefined` while
 * the lookup is still loading or if the mailbox isn't found in any account.
 *
 * Used by per-message Move actions where the `MessageActionMenu` only knows
 * the mailboxId — the picker must scope to the correct account or the
 * destination list would mix folders from unrelated accounts.
 */
export const useMailboxAccount = (
	mailboxId: string | undefined,
): MailboxAccountResolution => {
	const { data: config, isLoading: isConfigLoading } = useQuery({
		...configOperationsGetConfigOptions(),
		staleTime: Infinity,
	});

	const accountIds = useMemo(
		() => (config?.accounts ?? []).map((account) => account.accountId),
		[config?.accounts],
	);

	const mailboxQueries = useQueries({
		queries: accountIds.map((accountId) => ({
			...mailboxOperationsListMailboxesOptions({ path: { accountId } }),
			staleTime: Infinity,
			enabled: !!mailboxId,
		})),
	});

	const isLoading =
		isConfigLoading || mailboxQueries.some((query) => query.isLoading);

	const accountId = useMemo(() => {
		if (!mailboxId) return undefined;
		for (let i = 0; i < accountIds.length; i++) {
			const result = mailboxQueries[i];
			const items = result.data?.items ?? [];
			if (items.some((mailbox) => mailbox.mailboxId === mailboxId)) {
				return accountIds[i];
			}
		}
		return undefined;
	}, [mailboxId, accountIds, mailboxQueries]);

	return { accountId, isLoading };
};
