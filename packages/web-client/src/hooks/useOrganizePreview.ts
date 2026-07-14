import { organizeOperationsPreviewOrganizeMutation } from "@remit/api-http-client/@tanstack/react-query.gen.ts";
import { useMutation } from "@tanstack/react-query";
import { useCallback } from "react";
import {
	buildOrganizeInput,
	type OrganizeDraft,
} from "@/lib/organize/organize-model";

/**
 * "Select similar messages" (the widen step). Runs the read-only matcher once
 * server-side (POST /organize/preview) and returns the messages the same
 * predicate would apply an action to — the previewed set equals the set a job
 * with the same input would apply to. This is the only corpus-wide query the
 * flow makes; there is no client-side pagination over messages.
 */
export const useOrganizePreview = (accountId: string | undefined) => {
	const mutation = useMutation(organizeOperationsPreviewOrganizeMutation());
	const { mutate } = mutation;

	const preview = useCallback(
		(draft: OrganizeDraft) => {
			if (!accountId) return;
			mutate({
				path: { accountId },
				body: buildOrganizeInput(draft),
			});
		},
		[accountId, mutate],
	);

	return {
		preview,
		reset: mutation.reset,
		matchedCount: mutation.data?.matchedCount,
		messageIds: mutation.data?.messageIds,
		isPending: mutation.isPending,
		isError: mutation.isError,
		error: mutation.error,
	};
};
