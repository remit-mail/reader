/**
 * Single source of truth for the global keyboard triage layer (#429).
 *
 * Every shortcut the app responds to is declared here once. The help overlay
 * (`KeyboardShortcutsModal`), the list footer hints and the toolbar tooltips
 * all read from this module so the displayed bindings can never drift from the
 * keys the dispatcher actually routes. The spec lives in
 * `doc/design/flows/04-triage.md`.
 */

/** A logical action a key (or key sequence) maps to. */
export type TriageAction =
	// list navigation / focus model
	| "focusNext"
	| "focusPrevious"
	| "focusFirst"
	| "focusLast"
	| "openFocused"
	| "back"
	// selection
	| "toggleSelect"
	| "extendSelectDown"
	| "extendSelectUp"
	| "selectAll"
	// message verbs (focused row / selection)
	| "reply"
	| "replyAll"
	| "forward"
	| "delete"
	| "toggleStar"
	| "toggleRead"
	// sender verbs
	| "muteSender"
	| "blockSender"
	| "vipSender"
	| "markJunk"
	// view
	| "toggleIntelligence"
	| "toggleDensity"
	// global
	| "focusSearch"
	| "compose"
	| "help"
	// go-to sequences (g then …)
	| "goBrief"
	| "goInbox"
	| "goSent"
	| "goFlagged"
	| "goSettings";

/**
 * One displayed binding row in the help overlay. `keys` is the human-readable
 * sequence (e.g. ["g", "b"] or ["⌘", "N"]); `display` overrides the rendered
 * label when a single token reads better (e.g. "Esc", "↵").
 */
export interface KeyHint {
	action: TriageAction;
	/** Tokens rendered as individual <Kbd> chips, in order. */
	keys: string[];
	description: string;
}

export interface KeyHintGroup {
	title: string;
	hints: KeyHint[];
}

/**
 * The full key map, grouped by area, exactly as it appears in the `?` overlay.
 * Order is intentional (matches 04-triage.md reading order).
 */
export const KEY_HINT_GROUPS: KeyHintGroup[] = [
	{
		title: "Navigation",
		hints: [
			{ action: "focusNext", keys: ["j"], description: "Focus next message" },
			{
				action: "focusPrevious",
				keys: ["k"],
				description: "Focus previous message",
			},
			{ action: "focusNext", keys: ["↓"], description: "Focus next message" },
			{
				action: "focusPrevious",
				keys: ["↑"],
				description: "Focus previous message",
			},
			{ action: "focusFirst", keys: ["Home"], description: "Focus first" },
			{ action: "focusLast", keys: ["End"], description: "Focus last" },
			{
				action: "openFocused",
				keys: ["Enter"],
				description: "Open focused thread",
			},
			{ action: "back", keys: ["Esc"], description: "Back / close overlay" },
		],
	},
	{
		title: "Selection",
		hints: [
			{ action: "toggleSelect", keys: ["x"], description: "Toggle select" },
			{ action: "toggleSelect", keys: ["Space"], description: "Toggle select" },
			{
				action: "extendSelectDown",
				keys: ["Shift", "j"],
				description: "Extend selection down",
			},
			{
				action: "extendSelectUp",
				keys: ["Shift", "k"],
				description: "Extend selection up",
			},
			{
				action: "extendSelectDown",
				keys: ["Shift", "↓"],
				description: "Extend selection down",
			},
			{
				action: "extendSelectUp",
				keys: ["Shift", "↑"],
				description: "Extend selection up",
			},
			{ action: "selectAll", keys: ["⌘", "A"], description: "Select all" },
		],
	},
	{
		title: "Actions",
		hints: [
			{ action: "reply", keys: ["r"], description: "Reply" },
			{ action: "replyAll", keys: ["a"], description: "Reply all" },
			{ action: "forward", keys: ["f"], description: "Forward" },
			{ action: "delete", keys: ["#"], description: "Delete" },
			{ action: "toggleStar", keys: ["s"], description: "Star / unstar" },
			{
				action: "toggleRead",
				keys: ["u"],
				description: "Toggle read / unread",
			},
		],
	},
	{
		title: "Sender",
		hints: [
			{ action: "muteSender", keys: ["m"], description: "Mute sender" },
			{ action: "blockSender", keys: ["b"], description: "Block sender" },
			{ action: "vipSender", keys: ["v"], description: "VIP sender" },
			{ action: "markJunk", keys: ["!"], description: "Mark junk" },
		],
	},
	{
		title: "Go to",
		hints: [
			{ action: "goBrief", keys: ["g", "b"], description: "Daily brief" },
			{ action: "goInbox", keys: ["g", "i"], description: "Inbox" },
			{ action: "goSent", keys: ["g", "s"], description: "Sent" },
			{ action: "goFlagged", keys: ["g", "f"], description: "Starred" },
			{ action: "goSettings", keys: ["g", ","], description: "Settings" },
		],
	},
	{
		title: "View & global",
		hints: [
			{
				action: "toggleIntelligence",
				keys: ["i"],
				description: "Toggle intelligence",
			},
			{ action: "toggleDensity", keys: ["d"], description: "Toggle density" },
			{ action: "focusSearch", keys: ["/"], description: "Focus search" },
			{ action: "compose", keys: ["c"], description: "Compose" },
			{ action: "compose", keys: ["⌘", "N"], description: "Compose" },
			{ action: "help", keys: ["?"], description: "Shortcut help" },
		],
	},
];

/**
 * Look up the displayed key tokens for an action (first matching hint). Used by
 * toolbar tooltips so a single declaration drives both the overlay and the
 * button titles. Returns `undefined` for actions with no hint.
 */
export function keysForAction(action: TriageAction): string[] | undefined {
	for (const group of KEY_HINT_GROUPS) {
		const hint = group.hints.find((h) => h.action === action);
		if (hint) return hint.keys;
	}
	return undefined;
}

/**
 * Render an action's binding as a compact tooltip suffix, e.g. "(r)" or
 * "(g then b)". Returns "" when the action has no hint.
 */
export function tooltipForAction(action: TriageAction): string {
	const keys = keysForAction(action);
	if (!keys || keys.length === 0) return "";
	if (keys.length === 1) return `(${keys[0]})`;
	// Sequence (go-to) keys read as "g then b"; modifier combos as "⌘N".
	if (keys[0] === "g") return `(${keys.join(" then ")})`;
	return `(${keys.join("")})`;
}
