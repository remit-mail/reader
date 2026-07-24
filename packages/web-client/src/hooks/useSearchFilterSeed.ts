import { organizeOperationsPreviewOrganizeMutation } from "@remit/api-http-client/@tanstack/react-query.gen.ts";
import { useMutation } from "@tanstack/react-query";
import { useCallback, useEffect } from "react";
import { buildOrganizeInput } from "@/lib/organize/organize-model";
import type { OrganizeMatchPredicate } from "@/lib/organize/sender-fallback";

interface SearchFilterSeed {
	/** The live count for the converted literal predicate, seeding the editor. */
	seedCount?: number;
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

	const run = useCallback(() => {
		if (!accountId) return;
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
		isPending: seed.isPending || seed.data === undefined,
		isError: seed.isError,
		error: seed.error,
		retry: run,
	};
};
