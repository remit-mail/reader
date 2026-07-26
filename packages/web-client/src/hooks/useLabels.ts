import {
	labelDetailOperationsDeleteLabelMutation,
	labelDetailOperationsUpdateLabelMutation,
	labelOperationsCreateLabelMutation,
	labelOperationsListLabelsOptions,
	labelOperationsListLabelsQueryKey,
} from "@remit/api-http-client/@tanstack/react-query.gen.ts";
import type {
	RemitImapLabelColor,
	RemitImapUpdateLabelInput,
} from "@remit/api-http-client/types.gen.ts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";

/**
 * The query key the label list reads and every mutation invalidates on
 * success — the same contract `buildFilterListKey` pins for filters, so the
 * settings list and the rule editor's label picker never go stale after a
 * label is created, renamed, recolored, or deleted (issue #26).
 */
export const buildLabelListKey = (accountId: string) =>
	labelOperationsListLabelsQueryKey({ path: { accountId } });

/** List the account's labels. */
export const useLabelList = (accountId: string | undefined) => {
	const query = useQuery({
		...labelOperationsListLabelsOptions({
			path: { accountId: accountId ?? "" },
		}),
		enabled: !!accountId,
	});

	return {
		labels: query.data?.items ?? [],
		isPending: query.isPending,
		isError: query.isError,
		error: query.error,
		refetch: query.refetch,
	};
};

export const useCreateLabel = (accountId: string | undefined) => {
	const queryClient = useQueryClient();
	const mutation = useMutation({
		...labelOperationsCreateLabelMutation(),
		onSuccess: () => {
			if (!accountId) return;
			queryClient.invalidateQueries({ queryKey: buildLabelListKey(accountId) });
		},
	});
	const { mutateAsync } = mutation;

	const createLabel = useCallback(
		(name: string, color: RemitImapLabelColor = "Default") => {
			if (!accountId) return Promise.reject(new Error("No account"));
			return mutateAsync({ path: { accountId }, body: { name, color } });
		},
		[accountId, mutateAsync],
	);

	return {
		createLabel,
		isPending: mutation.isPending,
		isError: mutation.isError,
		error: mutation.error,
		reset: mutation.reset,
	};
};

export const useUpdateLabel = (accountId: string | undefined) => {
	const queryClient = useQueryClient();
	const mutation = useMutation({
		...labelDetailOperationsUpdateLabelMutation(),
		onSuccess: () => {
			if (!accountId) return;
			queryClient.invalidateQueries({ queryKey: buildLabelListKey(accountId) });
		},
	});
	const { mutate } = mutation;

	const updateLabel = useCallback(
		(labelId: string, input: RemitImapUpdateLabelInput) => {
			if (!accountId) return;
			mutate({ path: { accountId, labelId }, body: input });
		},
		[accountId, mutate],
	);

	return {
		updateLabel,
		isPending: mutation.isPending,
		updatingLabelId: mutation.isPending
			? mutation.variables?.path.labelId
			: undefined,
	};
};

export const useDeleteLabel = (accountId: string | undefined) => {
	const queryClient = useQueryClient();
	const mutation = useMutation({
		...labelDetailOperationsDeleteLabelMutation(),
		onSuccess: () => {
			if (!accountId) return;
			queryClient.invalidateQueries({ queryKey: buildLabelListKey(accountId) });
		},
	});
	const { mutate } = mutation;

	const deleteLabel = useCallback(
		(labelId: string) => {
			if (!accountId) return;
			mutate({ path: { accountId, labelId } });
		},
		[accountId, mutate],
	);

	return {
		deleteLabel,
		isPending: mutation.isPending,
		deletingLabelId: mutation.isPending
			? mutation.variables?.path.labelId
			: undefined,
	};
};
