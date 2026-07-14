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
				queryKey: filterOperationsListFiltersQueryKey({
					path: { accountId },
				}),
			});
		},
	});
	const { mutate } = mutation;

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

	return {
		createFilter,
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
				queryKey: filterOperationsListFiltersQueryKey({
					path: { accountId },
				}),
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
