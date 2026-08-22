import type { SelectionRestriction } from "@remit/ui";

/** The account a selection resolves to, and what that costs it. */
export interface SelectionAccountScope {
	/** The one account holding every selected row, when there is one. */
	accountId: string | undefined;
	/** Which scope the selection spans more of than Move can take. */
	restriction: SelectionRestriction | undefined;
	/** Why Move is withheld, in the toolbar's own words. */
	moveDisabledHint: string | undefined;
}

/**
 * Move applies within one account, so every surface offering it over a
 * selection asks the same question of the same fact — each row's own
 * `accountId`, never `accountConfigId`, which every account of one user shares
 * and so can never differ (#456). A row that carries no account of its own is
 * the caller's to fill in from its list scope before it gets here.
 */
export const resolveSelectionAccountScope = (
	accountIds: Iterable<string | undefined>,
): SelectionAccountScope => {
	const distinct = new Set<string>();
	for (const accountId of accountIds) {
		if (accountId) distinct.add(accountId);
	}
	if (distinct.size > 1) {
		return {
			accountId: undefined,
			restriction: "spansAccounts",
			moveDisabledHint:
				"Move only works within one account — clear selection or pick messages from a single account",
		};
	}
	return {
		accountId: distinct.size === 1 ? [...distinct][0] : undefined,
		restriction: undefined,
		moveDisabledHint: undefined,
	};
};
