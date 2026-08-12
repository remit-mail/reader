import type { TriageAction } from "./keymap.js";

/**
 * Pure resolver for the shortcut tree (#713, stage 1).
 *
 * `keymap-dispatch` decides *which* action a keystroke means. This module
 * decides *who answers it*: given the app's current shape, an action runs at one
 * level of the tree, is contained by an overlay or a field, is blocked for a
 * named reason, or is unbound.
 *
 * A node is a level, never a branch value. There are four — `app`, `mail`,
 * `list`, `detail` — plus two owners that pre-empt them: an overlay stack and
 * an editing field. Which list you are on, which detail surface is open and
 * which panes are on screen are *values* carried by those nodes, so the verb set
 * of a level is declared once and a precondition discriminates the cases.
 * Resolution walks leaf-to-root and the first served level wins, which is what
 * makes `j` mean "next message in the thread" on a phone and "next row" on a
 * desktop without either surface knowing the other exists.
 *
 * Nothing here touches React, the DOM or the router: the caller supplies the
 * tree and the handler registry, and maps an outcome to whatever the user
 * should see and to whether the keystroke is consumed.
 */

/** The four levels of the tree, root first. */
export type ShortcutLevel = "app" | "mail" | "list" | "detail";

/**
 * What a mailbox is *for*. The go-to keys name the inbox and the sent folder
 * without knowing any id, so the role travels with the list and stays a value
 * the resolver can compare.
 */
export type MailboxRole = "inbox" | "sent" | "other";

/** The list being browsed — the first segment under `/mail`. */
export type MailList =
	| { kind: "brief" }
	| { kind: "flagged" }
	| { kind: "outbox" }
	| { kind: "mailbox"; mailboxId: string; role: MailboxRole };

/** Where a go-to key would take you. */
export type GoToDestination = "brief" | "flagged" | "inbox" | "sent";

/** The detail surface open under the list. */
export type DetailSurface =
	| { kind: "thread"; threadId: string; messageId: string | null }
	| { kind: "compose"; draftId: string | null };

/** What the message verbs act on: the focused row, or the open thread. */
export interface Aim {
	threadId: string;
	messageId: string | null;
}

export interface DetailNode {
	surface: DetailSurface;
}

/**
 * Which panes the list holds. One value rather than a visibility flag beside an
 * optional detail, so "neither pane on screen" cannot be built: a hidden list
 * always means the detail has taken the screen.
 */
export type ListPane =
	| { layout: "list-only" }
	| { layout: "split"; detail: DetailNode }
	| { layout: "detail-only"; detail: DetailNode };

export interface ListNode {
	list: MailList;
	pane: ListPane;
	aim: Aim | null;
	/** Ids of the selected rows; the resolver reads its size, not a flag. */
	selection: readonly string[];
}

export interface MailNode {
	list: ListNode | null;
}

/**
 * A modal, sheet or menu. The stack's top frame is the leaf of the tree: it
 * either answers the action or contains it, and never leaks a key to the
 * surface behind it.
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
 * A precondition on a rule. A bare flag must hold; `{ not: "listVisible" }` is
 * the one negation the tree needs, and it is what gives the detail its own
 * navigation when the list is off screen; `listIsNot` is how a go-to action
 * declares that it is already where it would take you.
 */
export type Requirement =
	| ShortcutFlag
	| { not: "listVisible" }
	| { listIsNot: GoToDestination };

export interface ActionRule {
	action: TriageAction;
	requires: readonly Requirement[];
}

/**
 * Why a level that serves this action did not run it. Every reason is reachable
 * and every reason is the caller's to phrase: `list-off-screen` is ordinary
 * phone geometry and says nothing, while `not-aimed` and `no-selection` are
 * worth telling the user about.
 */
export type BlockedReason =
	| "settling"
	| "list-settling"
	| "list-off-screen"
	| "list-shown"
	| "not-aimed"
	| "no-selection"
	| "no-thread"
	| "already-there";

/** Who runs the action. */
export type ActTarget =
	| { kind: "overlay"; frame: OverlayFrame }
	| { kind: "editing"; field: EditingField }
	| { kind: "level"; level: ShortcutLevel };

/** Who swallowed the action without running it. */
export type ContainTarget =
	| { kind: "overlay"; frame: OverlayFrame }
	| { kind: "editing"; field: EditingField };

/**
 * `contained` and `unbound` are not the same silence. A contained key belongs to
 * the overlay or the field that swallowed it and must not reach the page behind
 * it; an unbound key was never ours, so the browser keeps it.
 */
export type Resolution =
	| { outcome: "act"; target: ActTarget }
	| { outcome: "contained"; by: ContainTarget }
	| { outcome: "blocked"; reason: BlockedReason }
	| { outcome: "unbound" };

/** Which actions a host serves, per level. */
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
 * may appear at more than one level; the leaf-most rule whose level serves it
 * and whose requirements hold wins.
 *
 * Help and the go-to family sit at `app` on purpose: `?` and `g …` are how you
 * leave a screen, so they must answer on settings, where there is no `mail`
 * node at all. Compose, search and the intelligence rail act on the mail
 * surface and stay at `mail`, where they are correctly dead on settings.
 * `goSettings` carries no `listIsNot` because settings is not a list; "already
 * on settings" is not expressible in a tree rooted at the mail address.
 */
export const NODE_ACTIONS: Record<ShortcutLevel, readonly ActionRule[]> = {
	app: [
		rule("help"),
		rule("goBrief", { listIsNot: "brief" }),
		rule("goFlagged", { listIsNot: "flagged" }),
		rule("goInbox", { listIsNot: "inbox" }),
		rule("goSent", { listIsNot: "sent" }),
		rule("goSettings"),
	],
	mail: [rule("compose"), rule("focusSearch"), rule("toggleIntelligence")],
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
		rule("back"),
	],
};

const UNMET_REASON: Record<ShortcutFlag, BlockedReason> = {
	listVisible: "list-off-screen",
	aimed: "not-aimed",
	selection: "no-selection",
	threadOpen: "no-thread",
};

function listNode(tree: ShortcutTree): ListNode | null {
	return tree.mail?.list ?? null;
}

function detailNode(list: ListNode): DetailNode | null {
	return list.pane.layout === "list-only" ? null : list.pane.detail;
}

function holds(flag: ShortcutFlag, tree: ShortcutTree): boolean {
	const list = listNode(tree);
	if (!list) return false;
	if (flag === "listVisible") return list.pane.layout !== "detail-only";
	if (flag === "aimed") return list.aim !== null;
	if (flag === "selection") return list.selection.length > 0;
	return detailNode(list)?.surface.kind === "thread";
}

function isAt(list: MailList, destination: GoToDestination): boolean {
	if (list.kind === "mailbox") {
		return destination === list.role;
	}
	return list.kind === destination;
}

function unmet(
	requirement: Requirement,
	tree: ShortcutTree,
): BlockedReason | null {
	if (typeof requirement === "string") {
		return holds(requirement, tree) ? null : UNMET_REASON[requirement];
	}
	if ("not" in requirement) {
		return holds(requirement.not, tree) ? "list-shown" : null;
	}
	const list = listNode(tree);
	if (!list) return null;
	return isAt(list.list, requirement.listIsNot) ? "already-there" : null;
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
	if (list && detailNode(list)) levels.push("detail");
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
 * chain entirely. Otherwise the walk runs leaf-to-root over the levels that
 * *serve* this action: the first one whose requirements hold acts, and a level
 * that declares the action but registers no handler is skipped as if it were not
 * there. A level nobody serves never contributes a reason, so an action a screen
 * does not offer stays silent instead of explaining itself.
 *
 * When no served level can run it, the root-most reason is reported: the
 * leaf-most failure is usually the geometry the user did not choose, while the
 * one above it is the thing they can act on.
 */
export function resolveShortcut(
	action: TriageAction,
	tree: ShortcutTree,
	registered: RegisteredActions,
): Resolution {
	const frame = tree.overlays.at(-1);
	if (frame) {
		if (!frame.handles.includes(action)) {
			return { outcome: "contained", by: { kind: "overlay", frame } };
		}
		return { outcome: "act", target: { kind: "overlay", frame } };
	}

	const field = tree.editing;
	if (field) {
		if (!field.handles.includes(action)) {
			return { outcome: "contained", by: { kind: "editing", field } };
		}
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
			if (!isRegistered(registered, level, action)) continue;
			const reason = firstUnmet(candidate.requires, tree);
			if (!reason) {
				return { outcome: "act", target: { kind: "level", level } };
			}
			blockedOn = reason;
		}
	}

	if (blockedOn) return { outcome: "blocked", reason: blockedOn };
	return { outcome: "unbound" };
}
