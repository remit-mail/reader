import {
	filterDetailOperationsGetFilterQueryKey,
	filterDetailOperationsUpdateFilterMutation,
} from "@remit/api-http-client/@tanstack/react-query.gen.ts";
import type { RemitImapUpdateFilterInput } from "@remit/api-http-client/types.gen.ts";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import { buildFilterListKey } from "./useFilters";

/**
 * Patch an existing filter (RFC 038 D6). The server bumps `ruleChangedAt` only
 * when the body touches a predicate or action field, never on a name-only
 * rename (RFC 034 Decision 3.2) — the caller decides which fields to send. On
 * success both the account's filter list and this filter's detail are
 * invalidated so the settings page and any open editor read the saved rule.
 */
export const useUpdateFilter = (
	accountId: string | undefined,
	filterId: string | undefined,
) => {
	const queryClient = useQueryClient();
	const mutation = useMutation({
		...filterDetailOperationsUpdateFilterMutation(),
		onSuccess: () => {
			if (!accountId) return;
			queryClient.invalidateQueries({
				queryKey: buildFilterListKey(accountId),
			});
			if (filterId) {
				queryClient.invalidateQueries({
					queryKey: filterDetailOperationsGetFilterQueryKey({
						path: { accountId, filterId },
					}),
				});
			}
		},
	});
	const { mutate } = mutation;

	const updateFilter = useCallback(
		(body: RemitImapUpdateFilterInput) => {
			if (!accountId || !filterId) return;
			mutate({ path: { accountId, filterId }, body });
		},
		[accountId, filterId, mutate],
	);

	return {
		updateFilter,
		isPending: mutation.isPending,
		isSuccess: mutation.isSuccess,
		isError: mutation.isError,
		error: mutation.error,
		reset: mutation.reset,
	};
};
