import type { OrganizeScope } from "./organize-model";
import { hasCommittableAction, type OrganizeDraft } from "./organize-model";

export interface CommitContext {
	draft: OrganizeDraft;
	scope: OrganizeScope;
	/** The filter name, required for the two standing scopes. */
	name: string;
	/** The raw picked date (`YYYY-MM-DD`), required for the temporary scope. */
	pickedDate: string;
}

/**
 * Why the commit button is disabled, or `undefined` when it is actionable.
 * Never disable a control without saying why (ux.md), so the caller renders
 * this string next to the button.
 */
export const commitDisabledReason = ({
	draft,
	scope,
	name,
	pickedDate,
}: CommitContext): string | undefined => {
	if (!hasCommittableAction(draft)) {
		return "Pick a folder to move these into — labeling isn't available yet.";
	}
	if ((scope === "standing" || scope === "temporary") && name.trim() === "") {
		return "Name this filter so you can find it later.";
	}
	if (scope === "temporary" && pickedDate === "") {
		return "Pick the date this should stop on.";
	}
	return undefined;
};

/** The commit button label for each scope. */
export const commitButtonLabel = (
	scope: OrganizeScope,
	matchedTotal: number,
): string => {
	switch (scope) {
		case "just-these":
			return `Move ${matchedTotal} message${matchedTotal === 1 ? "" : "s"}`;
		case "all-like-these":
			return `Organize ${matchedTotal} message${matchedTotal === 1 ? "" : "s"}`;
		case "standing":
			return "Always do this";
		case "temporary":
			return "Do this until then";
	}
};

/**
 * The count a scope acts on: the current selection for "just these", the
 * widened match set for every scope that reaches similar mail.
 */
export const scopeActionCount = (
	scope: OrganizeScope,
	selectionCount: number,
	matchedCount: number,
): number => (scope === "just-these" ? selectionCount : matchedCount);
