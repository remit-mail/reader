import type { TriageAction } from "./keymap.js";

/**
 * Pure resolver for the shortcut tree (#713, stage 1).
 *
 * `keymap-dispatch` decides *which* action a keystroke means. This module
 * decides *who answers it*: given the app's current shape, an action either
 * runs at one level of the tree, is blocked for a named reason, or is unbound.
 *
 * A node is a level, never a branch value. There are four — `app`, `mail`,
 * `list`, `detail` — plus two owners that pre-empt them: an overlay stack and
 * an editing field. Which list you are on, which detail surface is open and
 * whether the list is on screen are *values* carried by those nodes, so the
 * verb set of a level is declared once and a precondition discriminates the
 * cases. Resolution walks leaf-to-root and the first match wins, which is what
 * makes `j` mean "next message in the thread" on a phone and "next row" on a
 * desktop without either surface knowing the other exists.
 *
 * Nothing here touches React, the DOM or the router: the caller supplies the
 * tree and the handler registry, and maps a blocked reason to whatever the user
 * should see.
 */

/** The four levels of the tree, root last. */
export type ShortcutLevel = "app" | "mail" | "list" | "detail";

/** The list being browsed — the first segment under `/mail`. */
export type MailList =
	| { kind: "brief" }
	| { kind: "flagged" }
	| { kind: "outbox" }
	| { kind: "mailbox"; mailboxId: string };

/** The detail surface open under the list, if any. */
export type DetailSurface =
	| { kind: "thread"; threadId: string; messageId: string | null }
	| { kind: "compose"; draftId: string | null };

/** Whether the list shares the screen with the detail surface. */
export type ListVisibility = "visible" | "hidden";

/** What the message verbs act on: the focused row, or the open thread. */
export interface Aim {
	threadId: string;
	messageId: string | null;
}

export interface DetailNode {
	surface: DetailSurface;
}

export interface ListNode {
	list: MailList;
	visibility: ListVisibility;
	aim: Aim | null;
	/** Ids of the selected rows; the resolver reads its size, not a flag. */
	selection: readonly string[];
	detail: DetailNode | null;
}

export interface MailNode {
	list: ListNode | null;
}

/**
 * A modal, sheet or menu. The stack's top frame is the leaf of the tree, and
 * it either answers the action or the action is unbound — an overlay never
 * leaks a key to the surface behind it.
 */
export interface OverlayFrame {
	id: string;
	handles: readonly TriageAction[];
}

/** A focused editable surface. Same containment rule as an overlay frame. */
export interface EditingField {
	id: string;
	handles: readonly TriageAction[];
}

/**
 * What is mid-transition. `"app"` is a navigation in flight, `"list"` a list
 * still loading; both block every action until they land, so a key pressed
 * during a transition can never act on the surface it was not aimed at.
 */
export type SettlingScope = "app" | "list";

export interface ShortcutTree {
	overlays: readonly OverlayFrame[];
	editing: EditingField | null;
	settling: SettlingScope | null;
	mail: MailNode | null;
}

/** The facts a rule can require of the tree. */
export type ShortcutFlag = "listVisible" | "aimed" | "selection" | "threadOpen";

/**
 * A precondition on a rule. A bare flag must hold, `{ not }` must not, and
 * `listIsNot` is how a go-to action declares that it is already where it would
 * take you.
 */
export type Requirement =
	| ShortcutFlag
	| { not: ShortcutFlag }
	| { listIsNot: MailList };

export interface ActionRule {
	action: TriageAction;
	requires: readonly Requirement[];
}

/** Why an action that exists in the tree did not run. */
export type BlockedReason =
	| "settling"
	| "list-settling"
	| "no-list"
	| "list-shown"
	| "not-aimed"
	| "aim-set"
	| "no-selection"
	| "selection-present"
	| "no-thread"
	| "thread-open"
	| "already-there";

export type ActTarget =
	| { kind: "overlay"; frame: OverlayFrame }
	| { kind: "editing"; field: EditingField }
	| { kind: "level"; level: ShortcutLevel };

export type Resolution =
	| { outcome: "act"; target: ActTarget }
	| { outcome: "blocked"; reason: BlockedReason }
	| { outcome: "unbound" };

/** Which levels a host has a handler for, per level. */
export type RegisteredActions = Readonly<
	Partial<Record<ShortcutLevel, readonly TriageAction[]>>
>;

const LIST_VERBS: readonly TriageAction[] = [
	"reply",
	"replyAll",
	"forward",
	"delete",
	"toggleStar",
	"toggleRead",
	"muteSender",
	"blockSender",
	"vipSender",
	"markJunk",
];

const LIST_NAVIGATION: readonly TriageAction[] = [
	"focusNext",
	"focusPrevious",
	"focusFirst",
	"focusLast",
	"openFocused",
	"toggleSelect",
	"extendSelectDown",
	"extendSelectUp",
	"selectAll",
	"toggleDensity",
];

const rule = (
	action: TriageAction,
	...requires: Requirement[]
): ActionRule => ({ action, requires });

/**
 * Every action the app answers, declared at the level that owns it. An action
 * may appear at more than one level; the leaf-most rule whose requirements hold
 * and whose level has a handler wins.
 *
 * `goInbox` and `goSent` name mailboxes by id, which the tree does not know, so
 * they carry no `listIsNot` and the caller decides what "already there" means
 * for them. `goSettings` leaves `/mail` entirely, and settings is not a list.
 */
export const NODE_ACTIONS: Record<ShortcutLevel, readonly ActionRule[]> = {
	app: [],
	mail: [
		rule("compose"),
		rule("help"),
		rule("focusSearch"),
		rule("toggleIntelligence"),
		rule("goBrief", { listIsNot: { kind: "brief" } }),
		rule("goFlagged", { listIsNot: { kind: "flagged" } }),
		rule("goInbox"),
		rule("goSent"),
		rule("goSettings"),
	],
	list: [
		...LIST_NAVIGATION.map((action) => rule(action, "listVisible")),
		...LIST_VERBS.map((action) => rule(action, "aimed")),
		rule("back", "selection"),
	],
	detail: [
		rule("focusNext", "threadOpen", { not: "listVisible" }),
		rule("focusPrevious", "threadOpen", { not: "listVisible" }),
		rule("reply", "threadOpen"),
		rule("replyAll", "threadOpen"),
		rule("forward", "threadOpen"),
		rule("back", "threadOpen"),
	],
};

const UNMET_REASON: Record<ShortcutFlag, BlockedReason> = {
	listVisible: "no-list",
	aimed: "not-aimed",
	selection: "no-selection",
	threadOpen: "no-thread",
};

const NEGATED_REASON: Record<ShortcutFlag, BlockedReason> = {
	listVisible: "list-shown",
	aimed: "aim-set",
	selection: "selection-present",
	threadOpen: "thread-open",
};

function listNode(tree: ShortcutTree): ListNode | null {
	return tree.mail?.list ?? null;
}

function holds(flag: ShortcutFlag, tree: ShortcutTree): boolean {
	const list = listNode(tree);
	if (flag === "listVisible") return list?.visibility === "visible";
	if (flag === "aimed") return list?.aim != null;
	if (flag === "selection") return (list?.selection.length ?? 0) > 0;
	return list?.detail?.surface.kind === "thread";
}

function sameList(a: MailList, b: MailList): boolean {
	if (a.kind !== b.kind) return false;
	if (a.kind === "mailbox" && b.kind === "mailbox") {
		return a.mailboxId === b.mailboxId;
	}
	return true;
}

function unmet(
	requirement: Requirement,
	tree: ShortcutTree,
): BlockedReason | null {
	if (typeof requirement === "string") {
		return holds(requirement, tree) ? null : UNMET_REASON[requirement];
	}
	if ("not" in requirement) {
		return holds(requirement.not, tree)
			? NEGATED_REASON[requirement.not]
			: null;
	}
	const list = listNode(tree);
	if (!list) return null;
	return sameList(list.list, requirement.listIsNot) ? "already-there" : null;
}

function firstUnmet(
	requires: readonly Requirement[],
	tree: ShortcutTree,
): BlockedReason | null {
	for (const requirement of requires) {
		const reason = unmet(requirement, tree);
		if (reason) return reason;
	}
	return null;
}

/** The levels present in this tree, leaf first. */
function activeLevels(tree: ShortcutTree): ShortcutLevel[] {
	const list = listNode(tree);
	const levels: ShortcutLevel[] = [];
	if (list?.detail) levels.push("detail");
	if (list) levels.push("list");
	if (tree.mail) levels.push("mail");
	levels.push("app");
	return levels;
}

function isRegistered(
	registered: RegisteredActions,
	level: ShortcutLevel,
	action: TriageAction,
): boolean {
	return registered[level]?.includes(action) === true;
}

/**
 * Resolve an action against the tree. Pure: no DOM, no router, no side effects.
 *
 * The overlay stack and the editing field are leaves that pre-empt the level
 * chain entirely. Otherwise the walk runs leaf-to-root: the first rule whose
 * requirements hold and whose level has a handler acts; a level that declares
 * the action but has no handler falls through to the level above it. An action
 * declared somewhere but never runnable reports the first requirement it failed,
 * so the caller can say why instead of doing nothing.
 */
export function resolveShortcut(
	action: TriageAction,
	tree: ShortcutTree,
	registered: RegisteredActions,
): Resolution {
	const frame = tree.overlays.at(-1);
	if (frame) {
		if (!frame.handles.includes(action)) return { outcome: "unbound" };
		return { outcome: "act", target: { kind: "overlay", frame } };
	}

	const field = tree.editing;
	if (field) {
		if (!field.handles.includes(action)) return { outcome: "unbound" };
		return { outcome: "act", target: { kind: "editing", field } };
	}

	if (tree.settling) {
		const reason = tree.settling === "list" ? "list-settling" : "settling";
		return { outcome: "blocked", reason };
	}

	let blockedOn: BlockedReason | null = null;
	for (const level of activeLevels(tree)) {
		for (const candidate of NODE_ACTIONS[level]) {
			if (candidate.action !== action) continue;
			const reason = firstUnmet(candidate.requires, tree);
			if (reason) {
				blockedOn ??= reason;
				continue;
			}
			if (isRegistered(registered, level, action)) {
				return { outcome: "act", target: { kind: "level", level } };
			}
		}
	}

	if (blockedOn) return { outcome: "blocked", reason: blockedOn };
	return { outcome: "unbound" };
}
