import { organizeOperationsPreviewOrganizeMutation } from "@remit/api-http-client/@tanstack/react-query.gen.ts";
import type { PreviewCount } from "@remit/ui";
import { useMutation } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import type { OrganizeMatchPredicate } from "@/lib/organize/organize-model";
import { buildOrganizeInput } from "@/lib/organize/organize-model";
import {
	derivePreview,
	isEvaluablePredicate,
	PREVIEW_DEBOUNCE_MS,
	type PreviewState,
	predicateSignature,
	UNCOUNTABLE_PREDICATE_REASON,
} from "@/lib/organize/rule-model";

/**
 * The live match count for the edited rule (RFC 038 D1). Every predicate change
 * schedules a debounced `POST /organize/preview` and, until it lands, reports
 * the last count as stale so the count never blanks and the commit gate can
 * hold apply. Seeded with the widen probe's count, so opening the editor shows a
 * settled number without an immediate re-fetch.
 *
 * Out-of-order responses are dropped: only the reply to the most recent request
 * updates the count, so a slow early preview never overwrites a newer one. The
 * server bounds the match, so a broad predicate over a large mailbox stays a
 * single cheap request; the debounce is what keeps rapid edits from spamming it.
 *
 * `seedCount` is the opening count a widen probe already knows; omit it (as the
 * settings editor does, having no probe) to open on `loading` and preview the
 * loaded predicate immediately.
 */
export const useRulePreview = (
	accountId: string | undefined,
	predicate: OrganizeMatchPredicate,
	seedCount?: number,
): PreviewCount => {
	const mutation = useMutation(organizeOperationsPreviewOrganizeMutation());
	const { mutateAsync } = mutation;
	const currentSignature = predicateSignature(predicate);

	const [state, setState] = useState<PreviewState>(() =>
		seedCount === undefined
			? {}
			: { count: seedCount, previewedSignature: currentSignature },
	);

	const predicateRef = useRef(predicate);
	predicateRef.current = predicate;
	const latestRequested = useRef(currentSignature);
	// A predicate the matcher rejects outright is never sent — the request would
	// 500, and a 500 is not a count. The editor says so instead and holds the
	// commit for the scopes that would run this same matcher.
	const countable = isEvaluablePredicate(predicate);

	useEffect(() => {
		if (!accountId || !countable) return;
		if (currentSignature === state.previewedSignature) return;
		if (currentSignature === state.errorSignature) return;

		const handle = setTimeout(() => {
			const signature = currentSignature;
			latestRequested.current = signature;
			mutateAsync({
				path: { accountId },
				body: buildOrganizeInput({ ...predicateRef.current }),
			})
				.then((response) => {
					if (latestRequested.current !== signature) return;
					setState({
						count: response.matchedCount,
						previewedSignature: signature,
					});
				})
				.catch((error: unknown) => {
					if (latestRequested.current !== signature) return;
					setState((previous) => ({
						...previous,
						error:
							error instanceof Error
								? error.message
								: "Couldn't count matches.",
						errorSignature: signature,
					}));
				});
		}, PREVIEW_DEBOUNCE_MS);

		return () => clearTimeout(handle);
	}, [
		accountId,
		countable,
		currentSignature,
		state.previewedSignature,
		state.errorSignature,
		mutateAsync,
	]);

	if (!countable) {
		return { status: "error", reason: UNCOUNTABLE_PREDICATE_REASON };
	}
	return derivePreview(state, currentSignature);
};
