import type { ComposeBodyMode } from "../components/compose-mode-toggle.js";

/**
 * Which surface a draft reopens in, with no field of its own. `htmlBody` a
 * non-empty string is a rich draft; anything else is plain.
 *
 * Not "falsy": the rich editor serializes an empty document to `<p><br></p>`,
 * so a rich draft's `htmlBody` is never absent, and a plain draft clears the
 * column to the empty string rather than omitting it — absent means "leave
 * alone" at every layer below this one.
 */
export const modeOfDraft = (htmlBody: string | undefined): ComposeBodyMode =>
	typeof htmlBody === "string" && htmlBody.length > 0 ? "rich" : "plain";

/**
 * Whether switching to plain text destroys something. True for any node type or
 * text format the document holds that plain text cannot carry.
 */
export const switchNeedsWarning = (
	target: ComposeBodyMode,
	formatting: readonly string[],
): boolean => target === "plain" && formatting.length > 0;

export type ConversionOutcome =
	| { outcome: "switch" }
	| { outcome: "blocked"; title: string; detail: string };

const BLOCKED_TITLES: Record<ComposeBodyMode, string> = {
	plain: "Couldn't switch to plain text",
	rich: "Couldn't switch to rich text",
};

/**
 * A conversion that empties a written message does not happen. Autosave would
 * persist the blank body a moment later, so the draft would be gone with
 * nothing said. An empty body converting to an empty body is not this case.
 */
export const conversionOutcome = (
	target: ComposeBodyMode,
	source: string,
	converted: string,
): ConversionOutcome => {
	if (source.trim() === "" || converted.trim() !== "")
		return { outcome: "switch" };
	return {
		outcome: "blocked",
		title: BLOCKED_TITLES[target],
		detail: "The conversion came back empty, so your message is unchanged.",
	};
};
