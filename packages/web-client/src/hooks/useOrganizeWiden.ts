import { organizeOperationsPreviewOrganizeMutation } from "@remit/api-http-client/@tanstack/react-query.gen.ts";
import { deriveSenderClauses, distinctSenders } from "@remit/ui";
import { useMutation } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useState } from "react";
import { buildOrganizeInput } from "@/lib/organize/organize-model";
import {
	buildSenderFallbackDraft,
	type OrganizeMatchPredicate,
} from "@/lib/organize/sender-fallback";

/**
 * "Select similar messages" (the widen step) with a sender-derived fallback for
 * deployments without the vector pipeline.
 *
 * The first preview runs the semantic anchor (POST /organize/preview). When the
 * server reports `semanticUnavailable` — no vector pipeline on this deployment
 * (semantic-capability.ts) — the widen re-previews with the literal vocabulary
 * that matches vector-free: one `From` clause per distinct sender in the
 * selection, combined with `Or`, no anchor. The counts shown, the one-time
 * back-apply, and any standing filter then all carry that same literal
 * predicate, so the previewed set equals the set every commit scope acts on.
 *
 * A semantic-capable deployment never fires the second preview and keeps exactly
 * the anchor behaviour.
 */
export const useOrganizeWiden = (
	accountId: string | undefined,
	anchorMessageId: string | undefined,
	senders: readonly string[],
) => {
	const mutation = useMutation(organizeOperationsPreviewOrganizeMutation());
	const { mutate, reset: mutationReset } = mutation;
	const [fellBack, setFellBack] = useState(false);

	const distinct = useMemo(() => distinctSenders(senders), [senders]);

	const preview = useCallback(() => {
		if (!accountId || !anchorMessageId) return;
		setFellBack(false);
		mutate({
			path: { accountId },
			body: buildOrganizeInput({
				anchorMessageId,
				matchOperator: "And",
				literalClauses: [],
			}),
		});
	}, [accountId, anchorMessageId, mutate]);

	const reset = useCallback(() => {
		setFellBack(false);
		mutationReset();
	}, [mutationReset]);

	const data = mutation.data;
	// The first preview came back capability-absent and there are senders to
	// match on: re-preview with the literal clauses before showing any count, so
	// the count the user sees is the sender-match count, never a flash of the
	// empty semantic result.
	const willFallBack =
		data?.semanticUnavailable === true && !fellBack && distinct.length > 0;

	useEffect(() => {
		if (!willFallBack || !accountId) return;
		setFellBack(true);
		mutate({
			path: { accountId },
			body: buildOrganizeInput(buildSenderFallbackDraft(distinct)),
		});
	}, [willFallBack, accountId, distinct, mutate]);

	// The literal re-preview has no anchor, so its response reports
	// `semanticUnavailable: false`; `fellBack` is what remembers the capability
	// was absent once the fallback has run.
	const capabilityAbsent = fellBack || (data?.semanticUnavailable ?? false);
	const isPending = mutation.isPending || willFallBack;

	const matchPredicate: OrganizeMatchPredicate = fellBack
		? { matchOperator: "Or", literalClauses: deriveSenderClauses(distinct) }
		: {
				...(anchorMessageId ? { anchorMessageId } : {}),
				matchOperator: "And",
				literalClauses: [],
			};

	return {
		preview,
		reset,
		matchedCount: isPending ? undefined : data?.matchedCount,
		messageIds: isPending ? undefined : data?.messageIds,
		// The deployment ships no vector pipeline — the widen matched on senders
		// (or, with no senders, on nothing) rather than semantic similarity.
		semanticUnavailable: capabilityAbsent,
		// The widen fell back to sender matching and produced a usable literal
		// match set: the commit scopes reach it, and the copy names the senders.
		senderFallback: fellBack,
		senders: distinct,
		matchPredicate,
		isPending,
		isError: mutation.isError,
		error: mutation.error,
	};
};
