import type { RemitImapVipSuggestionsResponse } from "@remit/api-http-client/types.gen.ts";

export type SuggestedVipsState =
	| { kind: "loading" }
	| { kind: "error"; error: unknown }
	| { kind: "empty" }
	| { kind: "list"; data: RemitImapVipSuggestionsResponse };

interface QueryStateInput {
	isPending: boolean;
	isError: boolean;
	error: unknown;
	data: RemitImapVipSuggestionsResponse | undefined;
}

/**
 * Pure mapping from the React Query state into the four mutually exclusive
 * UI states. Empty must be distinguishable from error (per
 * `feedback_never_hide_failure`): a fetch that returned `suggestions: []`
 * is `empty`, a fetch that failed is `error`, and a fetch in flight is
 * `loading`.
 */
export const deriveSuggestedVipsState = (
	input: QueryStateInput,
): SuggestedVipsState => {
	if (input.isPending) return { kind: "loading" };
	if (input.isError) return { kind: "error", error: input.error };
	if (!input.data || input.data.suggestions.length === 0) {
		return { kind: "empty" };
	}
	return { kind: "list", data: input.data };
};
