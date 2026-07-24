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

/** How many sender addresses are named before the rest are summed as "N others". */
const MAX_SENDERS_SHOWN = 3;

/**
 * The sender addresses read out in prose: all of them when there are a few, or
 * the first {@link MAX_SENDERS_SHOWN} and a count of the rest so a long selection
 * stays legible in the sheet.
 */
export const formatSenderList = (senders: readonly string[]): string => {
	if (senders.length === 0) return "these senders";
	if (senders.length === 1) return senders[0];
	if (senders.length <= MAX_SENDERS_SHOWN) {
		return `${senders.slice(0, -1).join(", ")} and ${senders[senders.length - 1]}`;
	}
	const shown = senders.slice(0, MAX_SENDERS_SHOWN);
	const rest = senders.length - MAX_SENDERS_SHOWN;
	return `${shown.join(", ")} and ${rest} other${rest === 1 ? "" : "s"}`;
};

/**
 * The heading when the widen fell back to sender matching (no vector pipeline on
 * this server). States the actual semantics — matching every mail from these
 * senders — and never claims semantic similarity.
 */
export const senderFallbackSummary = (senders: readonly string[]): string =>
	`Similar-mail matching isn't available on this server — matching all mail from ${formatSenderList(
		senders,
	)} instead.`;
