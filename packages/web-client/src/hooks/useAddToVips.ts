import {
	addressDetailOperationsUpdateAddressMutation,
	meOperationsListVipSuggestionsQueryKey,
} from "@remit/api-http-client/@tanstack/react-query.gen.ts";
import type {
	RemitImapVipFlag,
	RemitImapVipSuggestionsResponse,
} from "@remit/api-http-client/types.gen.ts";
import { useMutation, useQueryClient } from "@tanstack/react-query";

interface AddToVipsContext {
	queryKey: readonly unknown[];
	previous: RemitImapVipSuggestionsResponse | undefined;
}

export const buildVipFlag = (now: number = Date.now()): RemitImapVipFlag => ({
	value: true,
	setAt: now,
	setBy: "user",
});

export const removeAddressFromSuggestions = (
	data: RemitImapVipSuggestionsResponse,
	addressId: string,
): RemitImapVipSuggestionsResponse => ({
	...data,
	suggestions: data.suggestions.filter(
		(entry) => entry.addressId !== addressId,
	),
});

/**
 * Promote a suggested address to VIP via the existing flag-mutation endpoint
 * (issue #182). Optimistically removes the row from the suggestions cache so
 * the UI updates without a round-trip; rolls back on error per the project's
 * "never hide failure" rule (the caller is expected to render the mutation
 * `error` in an alert banner — toasts are banned).
 */
export const useAddToVips = () => {
	const queryClient = useQueryClient();
	const queryKey = meOperationsListVipSuggestionsQueryKey();

	const mutation = useMutation({
		...addressDetailOperationsUpdateAddressMutation(),
		onMutate: async (vars): Promise<AddToVipsContext> => {
			const addressId = vars.path.addressId;
			await queryClient.cancelQueries({ queryKey });
			const previous =
				queryClient.getQueryData<RemitImapVipSuggestionsResponse>(queryKey);
			if (previous) {
				queryClient.setQueryData<RemitImapVipSuggestionsResponse>(
					queryKey,
					removeAddressFromSuggestions(previous, addressId),
				);
			}
			return { queryKey, previous };
		},
		onError: (_err, _vars, context) => {
			if (context?.previous) {
				queryClient.setQueryData(context.queryKey, context.previous);
			}
		},
		onSettled: () => {
			queryClient.invalidateQueries({ queryKey });
		},
	});

	const addToVips = (addressId: string) => {
		mutation.mutate({
			path: { addressId },
			body: { flags: { vip: buildVipFlag() } },
		});
	};

	return {
		addToVips,
		isPending: mutation.isPending,
		pendingAddressId: mutation.isPending
			? mutation.variables?.path.addressId
			: undefined,
		error: mutation.error,
		reset: mutation.reset,
	};
};
