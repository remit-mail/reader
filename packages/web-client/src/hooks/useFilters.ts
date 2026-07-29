import {
	filterDetailOperationsDeleteFilterMutation,
	filterOperationsCreateFilterMutation,
	filterOperationsListFiltersOptions,
	filterOperationsListFiltersQueryKey,
} from "@remit/api-http-client/@tanstack/react-query.gen.ts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import {
	buildCreateFilterInput,
	type OrganizeDraft,
	type OrganizeScope,
} from "@/lib/organize/organize-model";

/**
 * The query key the filter list reads and both mutations invalidate on success.
 * Extracted so create/delete invalidate exactly the key `useFilterList`
 * subscribes to — a drift here would leave the settings list stale after a
 * filter is created or deleted (the same contract `buildMailboxListKey` pins
 * for trigger-sync).
 */
export const buildFilterListKey = (accountId: string) =>
	filterOperationsListFiltersQueryKey({ path: { accountId } });

/**
 * List the account's standing filters (Standing + Temporary). Expired
 * Temporary filters stay in the list — they are shown distinctly, never hidden
 * (RFC 034 Decision 1.2).
 */
export const useFilterList = (accountId: string | undefined) => {
	const query = useQuery({
		...filterOperationsListFiltersOptions({
			path: { accountId: accountId ?? "" },
		}),
		enabled: !!accountId,
	});

	return {
		filters: query.data?.items ?? [],
		isPending: query.isPending,
		isError: query.isError,
		error: query.error,
		refetch: query.refetch,
	};
};

/**
 * Create the standing (`"these and new mail like this"`) or temporary
 * (`"until <date>"`) filter for an organize draft. The two one-time scopes
 * never create a filter (RFC 034 recap) and are not handled here.
 */
export const useCreateFilter = (accountId: string | undefined) => {
	const queryClient = useQueryClient();
	const mutation = useMutation({
		...filterOperationsCreateFilterMutation(),
		onSuccess: () => {
			if (!accountId) return;
			queryClient.invalidateQueries({
				queryKey: buildFilterListKey(accountId),
			});
		},
	});
	const { mutate, mutateAsync } = mutation;

	const createFilter = useCallback(
		(
			draft: OrganizeDraft,
			scope: Extract<OrganizeScope, "standing" | "temporary">,
			name: string,
		) => {
			if (!accountId) return;
			mutate({
				path: { accountId },
				body: buildCreateFilterInput(draft, scope, name),
			});
		},
		[accountId, mutate],
	);

	/**
	 * The same create, resolved once the server has the filter, for work that has
	 * to follow it — the pass over the mail already in the mailbox. Chaining that
	 * to the request rather than to the surface is what keeps it running when the
	 * surface is closed while the create is still in flight.
	 *
	 * `false` means the create did not land. The failure itself is on `isError`,
	 * which is what the surface reports and retries from, so it is not raised a
	 * second time here.
	 */
	const createFilterAsync = useCallback(
		async (
			draft: OrganizeDraft,
			scope: Extract<OrganizeScope, "standing" | "temporary">,
			name: string,
		): Promise<boolean> => {
			if (!accountId) return false;
			return mutateAsync({
				path: { accountId },
				body: buildCreateFilterInput(draft, scope, name),
			}).then(
				() => true,
				() => false,
			);
		},
		[accountId, mutateAsync],
	);

	return {
		createFilter,
		createFilterAsync,
		isPending: mutation.isPending,
		isSuccess: mutation.isSuccess,
		isError: mutation.isError,
		error: mutation.error,
		reset: mutation.reset,
	};
};

export const useDeleteFilter = (accountId: string | undefined) => {
	const queryClient = useQueryClient();
	const mutation = useMutation({
		...filterDetailOperationsDeleteFilterMutation(),
		onSuccess: () => {
			if (!accountId) return;
			queryClient.invalidateQueries({
				queryKey: buildFilterListKey(accountId),
			});
		},
	});
	const { mutate } = mutation;

	const deleteFilter = useCallback(
		(filterId: string) => {
			if (!accountId) return;
			mutate({ path: { accountId, filterId } });
		},
		[accountId, mutate],
	);

	return {
		deleteFilter,
		isPending: mutation.isPending,
		deletingFilterId: mutation.isPending
			? mutation.variables?.path.filterId
			: undefined,
	};
};
