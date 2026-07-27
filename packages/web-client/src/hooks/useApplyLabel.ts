import { messageBulkOperationsUpdateMessageLabelsMutation } from "@remit/api-http-client/@tanstack/react-query.gen.ts";
import type {
	RemitImapLabelAction,
	RemitImapThreadMessageResponse,
} from "@remit/api-http-client/types.gen.ts";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import { useErrorBanners } from "@/components/ui/ErrorBannerProvider";
import { formatErrorDetail } from "@/components/ui/error-banners";
import { resolveMailboxesForMessages } from "@/hooks/useMarkAsRead";
import { runChunkedMutation } from "@/lib/bulk-actions";
import {
	invalidateThreadListQueries,
	threadListCacheKeys,
} from "@/lib/thread-list-cache";

/**
 * Apply or remove a label on a "just these" selection (issue #26, RFC 034
 * recap). No optimistic patch: a label is metadata on the row, not something
 * that removes it from the current view, so settling on the server response
 * and invalidating is enough — unlike a move or delete, which the row leaves
 * immediately.
 */
export const useApplyLabel = (options: {
	mailboxId: string;
	accountId?: string;
	/** The threads the selection may span, for resolving which mailbox lists to invalidate. */
	messages?: RemitImapThreadMessageResponse[];
}) => {
	const { mailboxId, messages } = options;
	const queryClient = useQueryClient();
	const { pushError } = useErrorBanners();

	const { mutateAsync, isPending } = useMutation({
		...messageBulkOperationsUpdateMessageLabelsMutation(),
		onError: (error, variables) => {
			pushError({
				title:
					variables.body.action === "Remove"
						? "Couldn't remove label"
						: "Couldn't apply label",
				detail: formatErrorDetail(error),
				error,
			});
		},
		onSettled: (_data, _error, variables) => {
			invalidateThreadListQueries(
				queryClient,
				threadListCacheKeys(
					resolveMailboxesForMessages(
						variables.body.messageIds ?? [],
						messages ?? [],
						mailboxId,
					),
				),
			);
		},
	});

	const applyLabel = useCallback(
		(messageIds: string[], labelId: string, action: RemitImapLabelAction) => {
			if (messageIds.length === 0) return;
			void runChunkedMutation(messageIds, (chunk) =>
				mutateAsync({ body: { messageIds: chunk, labelId, action } }),
			);
		},
		[mutateAsync],
	);

	return { applyLabel, isPending };
};
