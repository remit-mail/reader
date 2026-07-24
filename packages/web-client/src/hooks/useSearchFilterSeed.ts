import { organizeOperationsPreviewOrganizeMutation } from "@remit/api-http-client/@tanstack/react-query.gen.ts";
import { useMutation } from "@tanstack/react-query";
import { useCallback, useEffect } from "react";
import { buildOrganizeInput } from "@/lib/organize/organize-model";
import type { OrganizeMatchPredicate } from "@/lib/organize/sender-fallback";

interface SearchFilterSeed {
	/** The live count for the converted literal predicate, seeding the editor. */
	seedCount?: number;
	/**
	 * Whether this deployment can match by meaning at request time (RFC 038 D5).
	 * Read from the same `semanticUnavailable` signal the Organize widen uses,
	 * probed with the search's top result as the anchor. `true` when there is no
	 * free text to embed (the flag then affects nothing).
	 */
	semanticAvailable: boolean;
	isPending: boolean;
	isError: boolean;
	error: unknown;
	retry: () => void;
}

/**
 * Open the filter-from-search editor: seed the live count from the converted
 * literal predicate, and read the deployment's semantic capability from the
 * existing Organize preview signal rather than a new probe of its own. The
 * capability read is anchored on the search's top result (`probeMessageId`), the
 * one message on this surface with indexed vectors to test the widen against; a
 * deployment without the vector pipeline answers `semanticUnavailable`, which is
 * what the conversion states it dropped.
 *
 * The probe runs only when there is free text to embed and a message to anchor
 * on. Its matched count is discarded — the editor counts the literal predicate,
 * so the count on screen is the set a literal-only filter applies to.
 */
export const useSearchFilterSeed = (
	accountId: string | undefined,
	literalPredicate: OrganizeMatchPredicate,
	hasFreeText: boolean,
	probeMessageId: string | undefined,
): SearchFilterSeed => {
	const seed = useMutation(organizeOperationsPreviewOrganizeMutation());
	const probe = useMutation(organizeOperationsPreviewOrganizeMutation());
	const { mutate: seedMutate, reset: seedReset } = seed;
	const { mutate: probeMutate, reset: probeReset } = probe;

	const needsProbe = hasFreeText && probeMessageId !== undefined;

	const run = useCallback(() => {
		if (!accountId) return;
		seedReset();
		seedMutate({
			path: { accountId },
			body: buildOrganizeInput({
				matchOperator: literalPredicate.matchOperator,
				literalClauses: literalPredicate.literalClauses,
			}),
		});
		if (!hasFreeText || probeMessageId === undefined) {
			probeReset();
			return;
		}
		probeMutate({
			path: { accountId },
			body: buildOrganizeInput({
				anchorMessageId: probeMessageId,
				matchOperator: "And",
				literalClauses: [],
			}),
		});
	}, [
		accountId,
		hasFreeText,
		literalPredicate.matchOperator,
		literalPredicate.literalClauses,
		probeMessageId,
		seedMutate,
		seedReset,
		probeMutate,
		probeReset,
	]);

	useEffect(() => {
		run();
	}, [run]);

	const probePending =
		needsProbe && (probe.isPending || probe.data === undefined);
	const isPending = seed.isPending || seed.data === undefined || probePending;

	return {
		seedCount: seed.data?.matchedCount,
		semanticAvailable: needsProbe
			? probe.data?.semanticUnavailable !== true
			: true,
		isPending,
		isError: seed.isError || (needsProbe && probe.isError),
		error: seed.error ?? probe.error,
		retry: run,
	};
};
