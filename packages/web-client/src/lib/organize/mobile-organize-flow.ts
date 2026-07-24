import type { OrganizeScope } from "./organize-model";

/**
 * How the guided mobile flow was entered from the selection sheet:
 *
 * - `select-similar` — widen straight into the organize sentence.
 * - `something-else` — collect a folder/scope seed from shortcuts or a
 *   plain-language input first, then widen into the seeded sentence.
 */
export type OrganizeEntry = "select-similar" | "something-else";

/** The read-only widen preview's lifecycle (POST /organize/preview). */
export type PreviewStatus = "idle" | "pending" | "success" | "error";

/** A folder/scope the "Something else" panel pre-fills the sentence with. */
export interface OrganizeSeed {
	moveMailboxId?: string;
	scope?: OrganizeScope;
}

/**
 * The stage the guided flow renders, resolved from the entry, whether a
 * "Something else" seed has been chosen yet, and where the widen preview is:
 *
 * - `something-else` — the shortcuts + input, shown until a seed is picked.
 * - `widening` — the brief widening state between the tap and the sentence.
 * - `error` — the widen failed; a dead end only in the sense that it offers a
 *   close, never a broken sentence.
 * - `organize` — the committed sentence, on the widened set. `fallback` is true
 *   when the widen matched nothing, so the sentence organizes just the
 *   selection instead of a dead end (issue #211).
 */
export type OrganizeStage =
	| { kind: "something-else" }
	| { kind: "widening" }
	| { kind: "error" }
	| { kind: "organize"; matchedCount: number; fallback: boolean };

export interface OrganizeStageInput {
	entry: OrganizeEntry;
	/** "Something else" only: whether the user has chosen a seed yet. */
	hasSeed: boolean;
	previewStatus: PreviewStatus;
	/** The widen's matched total; defined once `previewStatus` is `success`. */
	matchedCount: number | undefined;
}

/**
 * The pure state machine behind the guided organize sheet:
 * `idle → widening → organize` for select-similar, with a `something-else`
 * seeding step in front for that entry, an `error` branch when the widen
 * fails, and the zero-match `fallback` that keeps the organize sentence usable
 * on the selection alone. Kept pure so every transition is testable without a
 * DOM, React Query, or a network — the component only reads the stage back.
 */
export const resolveOrganizeStage = ({
	entry,
	hasSeed,
	previewStatus,
	matchedCount,
}: OrganizeStageInput): OrganizeStage => {
	if (entry === "something-else" && !hasSeed) {
		return { kind: "something-else" };
	}
	if (previewStatus === "error") {
		return { kind: "error" };
	}
	if (previewStatus !== "success") {
		return { kind: "widening" };
	}
	const matched = matchedCount ?? 0;
	return { kind: "organize", matchedCount: matched, fallback: matched === 0 };
};
