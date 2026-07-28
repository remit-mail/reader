import { organizeOperationsPreviewOrganizeMutation } from "@remit/api-http-client/@tanstack/react-query.gen.ts";
import { useMutation } from "@tanstack/react-query";
import { useCallback, useEffect } from "react";
import type { OrganizeMatchPredicate } from "@/lib/organize/organize-model";
import { buildOrganizeInput } from "@/lib/organize/organize-model";
import { isEvaluablePredicate } from "@/lib/organize/rule-model";

interface SearchFilterSeed {
	/** The live count for the converted literal predicate, seeding the editor. */
	seedCount?: number;
	/**
	 * The converted predicate is one the vector-free matcher refuses — a free-text
	 * search kept as a `HasWords` clause. There is no count to seed and no request
	 * to make.
	 */
	uncountable: boolean;
	isPending: boolean;
	isError: boolean;
	error: unknown;
	retry: () => void;
}

/**
 * Open the filter-from-search editor: seed the live count from the converted
 * literal predicate. One `POST /organize/preview` under the account the filter
 * targets — the count on screen is the set a literal-only filter applies to.
 *
 * A search whose terms convert to a `HasWords` clause has no count to seed: the
 * vector-free matcher reads no message bodies and rejects the predicate outright
 * (`assertNoBodyContentClause`), so asking is a 500 and a 500 is not a count.
 * That search is still a legitimate standing filter — the index-time matcher
 * does read bodies — so the editor opens on the uncountable reason and holds only
 * the one-time apply, the same way {@link useRulePreview} handles the clause
 * being added by hand.
 *
 * The deployment's semantic reach is not probed here; it is read from the
 * search's own "Related" results on the surface that opens the editor (RFC 038
 * D5), a direct signal that needs no request and cannot hit the wrong account.
 */
export const useSearchFilterSeed = (
	accountId: string | undefined,
	literalPredicate: OrganizeMatchPredicate,
): SearchFilterSeed => {
	const seed = useMutation(organizeOperationsPreviewOrganizeMutation());
	const { mutate, reset } = seed;
	const countable = isEvaluablePredicate(literalPredicate);

	const run = useCallback(() => {
		if (!accountId || !countable) return;
		reset();
		mutate({
			path: { accountId },
			body: buildOrganizeInput({
				matchOperator: literalPredicate.matchOperator,
				literalClauses: literalPredicate.literalClauses,
			}),
		});
	}, [
		accountId,
		countable,
		literalPredicate.matchOperator,
		literalPredicate.literalClauses,
		mutate,
		reset,
	]);

	useEffect(() => {
		run();
	}, [run]);

	return {
		seedCount: seed.data?.matchedCount,
		uncountable: !countable,
		isPending: countable && (seed.isPending || seed.data === undefined),
		isError: countable && seed.isError,
		error: seed.error,
		retry: run,
	};
};
