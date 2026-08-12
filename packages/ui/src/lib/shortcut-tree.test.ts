import assert from "node:assert";
import { describe, test } from "node:test";
import { KEY_HINT_GROUPS, type TriageAction } from "./keymap.js";
import {
	type EditingField,
	type ListNode,
	type MailList,
	NODE_ACTIONS,
	type OverlayFrame,
	type RegisteredActions,
	type Resolution,
	resolveShortcut,
	type ShortcutTree,
} from "./shortcut-tree.js";

const brief: MailList = { kind: "brief" };

const listNode = (partial: Partial<ListNode> = {}): ListNode => ({
	list: brief,
	visibility: "visible",
	aim: null,
	selection: [],
	detail: null,
	...partial,
});

const tree = (partial: Partial<ShortcutTree> = {}): ShortcutTree => ({
	overlays: [],
	editing: null,
	settling: null,
	mail: { list: listNode() },
	...partial,
});

const onList = (partial: Partial<ListNode> = {}): ShortcutTree =>
	tree({ mail: { list: listNode(partial) } });

const threadOpen = (visibility: ListNode["visibility"]): ShortcutTree =>
	onList({
		visibility,
		aim: { threadId: "t1", messageId: null },
		detail: {
			surface: { kind: "thread", threadId: "t1", messageId: null },
		},
	});

const everywhere: RegisteredActions = {
	app: allActions(),
	mail: allActions(),
	list: allActions(),
	detail: allActions(),
};

function allActions(): TriageAction[] {
	return KEY_HINT_GROUPS.flatMap((group) =>
		group.hints.map((hint) => hint.action),
	);
}

const acted = (result: Resolution): string => {
	if (result.outcome !== "act")
		assert.fail(`expected act, got ${result.outcome}`);
	if (result.target.kind === "level") return result.target.level;
	if (result.target.kind === "overlay") {
		return `overlay:${result.target.frame.id}`;
	}
	return `editing:${result.target.field.id}`;
};

const blockedFor = (result: Resolution): string => {
	if (result.outcome !== "blocked") {
		assert.fail(`expected blocked, got ${result.outcome}`);
	}
	return result.reason;
};

describe("shortcut tree", () => {
	test("every declared action is one the keymap can produce", () => {
		const known = new Set(allActions());
		for (const rules of Object.values(NODE_ACTIONS)) {
			for (const rule of rules) {
				assert.ok(known.has(rule.action), `${rule.action} is a known action`);
			}
		}
	});

	test("every keymap action is declared somewhere in the tree", () => {
		const declared = new Set(
			Object.values(NODE_ACTIONS).flatMap((rules) =>
				rules.map((rule) => rule.action),
			),
		);
		for (const action of allActions()) {
			assert.ok(declared.has(action), `${action} is declared`);
		}
	});

	test("the top overlay frame answers, and pre-empts every level", () => {
		const overlays: OverlayFrame[] = [
			{ id: "sheet", handles: ["back"] },
			{ id: "confirm", handles: ["back", "reply"] },
		];
		const withOverlay = tree({ overlays });
		assert.strictEqual(
			acted(resolveShortcut("back", withOverlay, {})),
			"overlay:confirm",
		);
		assert.strictEqual(
			acted(resolveShortcut("reply", withOverlay, everywhere)),
			"overlay:confirm",
		);
	});

	test("an overlay swallows what it does not handle", () => {
		const withOverlay = tree({
			overlays: [{ id: "confirm", handles: ["back"] }],
		});
		assert.strictEqual(
			resolveShortcut("focusNext", withOverlay, everywhere).outcome,
			"unbound",
		);
	});

	test("an editing field pre-empts the level chain", () => {
		const editing: EditingField = { id: "search", handles: ["back"] };
		const typing = tree({ editing });
		assert.strictEqual(
			acted(resolveShortcut("back", typing, everywhere)),
			"editing:search",
		);
		assert.strictEqual(
			resolveShortcut("focusNext", typing, everywhere).outcome,
			"unbound",
		);
	});

	test("an overlay outranks an editing field", () => {
		const both = tree({
			overlays: [{ id: "compose-modal", handles: ["back"] }],
			editing: { id: "subject", handles: ["back"] },
		});
		assert.strictEqual(
			acted(resolveShortcut("back", both, {})),
			"overlay:compose-modal",
		);
	});

	test("settling blocks everything, and names its scope", () => {
		for (const action of allActions()) {
			assert.strictEqual(
				blockedFor(
					resolveShortcut(action, tree({ settling: "app" }), everywhere),
				),
				"settling",
			);
		}
		assert.strictEqual(
			blockedFor(
				resolveShortcut("reply", tree({ settling: "list" }), everywhere),
			),
			"list-settling",
		);
	});

	test("focusNext walks to the list when the list is on screen", () => {
		const desktop = threadOpen("visible");
		assert.strictEqual(
			acted(resolveShortcut("focusNext", desktop, everywhere)),
			"list",
		);
		assert.strictEqual(
			acted(resolveShortcut("focusPrevious", desktop, everywhere)),
			"list",
		);
	});

	test("focusNext stops at the detail when the list is not on screen", () => {
		const phone = threadOpen("hidden");
		assert.strictEqual(
			acted(resolveShortcut("focusNext", phone, everywhere)),
			"detail",
		);
		assert.strictEqual(
			acted(resolveShortcut("focusPrevious", phone, everywhere)),
			"detail",
		);
	});

	test("with the list hidden and no thread, focusNext blocks on the list", () => {
		const phoneList = onList({ visibility: "hidden" });
		assert.strictEqual(
			blockedFor(resolveShortcut("focusNext", phoneList, everywhere)),
			"no-list",
		);
	});

	test("a level that declares an action but registers no handler falls through", () => {
		const phone = threadOpen("hidden");
		assert.strictEqual(
			acted(resolveShortcut("reply", phone, { list: ["reply"] })),
			"list",
		);
		assert.strictEqual(
			acted(
				resolveShortcut("reply", phone, { detail: ["reply"], list: ["reply"] }),
			),
			"detail",
		);
	});

	test("an action nobody registers is unbound, not blocked", () => {
		assert.strictEqual(
			resolveShortcut("compose", tree(), {}).outcome,
			"unbound",
		);
	});

	test("an action with no rule anywhere is unbound", () => {
		const bare = tree({ mail: null });
		assert.strictEqual(
			resolveShortcut("toggleStar", bare, everywhere).outcome,
			"unbound",
		);
	});

	test("list verbs need an aim", () => {
		assert.strictEqual(
			blockedFor(resolveShortcut("toggleStar", onList(), everywhere)),
			"not-aimed",
		);
		assert.strictEqual(
			acted(
				resolveShortcut(
					"toggleStar",
					onList({ aim: { threadId: "t1", messageId: null } }),
					everywhere,
				),
			),
			"list",
		);
	});

	test("back clears a selection on the list and closes a thread on the detail", () => {
		assert.strictEqual(
			blockedFor(resolveShortcut("back", onList(), everywhere)),
			"no-selection",
		);
		assert.strictEqual(
			acted(resolveShortcut("back", onList({ selection: ["m1"] }), everywhere)),
			"list",
		);
		assert.strictEqual(
			acted(resolveShortcut("back", threadOpen("visible"), everywhere)),
			"detail",
		);
	});

	test("a compose surface is not a thread", () => {
		const composing = onList({
			visibility: "hidden",
			detail: { surface: { kind: "compose", draftId: null } },
		});
		assert.strictEqual(
			blockedFor(resolveShortcut("focusNext", composing, everywhere)),
			"no-thread",
		);
	});

	test("goBrief is already-there on the brief and acts elsewhere", () => {
		assert.strictEqual(
			blockedFor(
				resolveShortcut("goBrief", onList({ list: brief }), everywhere),
			),
			"already-there",
		);
		assert.strictEqual(
			acted(
				resolveShortcut(
					"goBrief",
					onList({ list: { kind: "flagged" } }),
					everywhere,
				),
			),
			"mail",
		);
		assert.strictEqual(
			blockedFor(
				resolveShortcut(
					"goFlagged",
					onList({ list: { kind: "flagged" } }),
					everywhere,
				),
			),
			"already-there",
		);
	});

	test("mailbox lists compare by id", () => {
		const inbox: MailList = { kind: "mailbox", mailboxId: "a" };
		const other: MailList = { kind: "mailbox", mailboxId: "b" };
		assert.strictEqual(
			acted(resolveShortcut("goBrief", onList({ list: inbox }), everywhere)),
			"mail",
		);
		assert.strictEqual(
			acted(resolveShortcut("goInbox", onList({ list: other }), everywhere)),
			"mail",
		);
	});

	test("a go-to action outside any list is not already-there", () => {
		const noList = tree({ mail: { list: null } });
		assert.strictEqual(
			acted(resolveShortcut("goBrief", noList, everywhere)),
			"mail",
		);
	});

	test("mail-level globals need nothing", () => {
		const globals: TriageAction[] = [
			"compose",
			"help",
			"focusSearch",
			"toggleIntelligence",
			"goSettings",
		];
		for (const action of globals) {
			assert.strictEqual(
				acted(
					resolveShortcut(action, tree({ mail: { list: null } }), everywhere),
				),
				"mail",
			);
		}
	});

	test("the first unmet requirement is the reported reason", () => {
		const composing = onList({
			visibility: "visible",
			detail: { surface: { kind: "compose", draftId: "d1" } },
		});
		assert.strictEqual(
			blockedFor(
				resolveShortcut("forward", composing, { detail: ["forward"] }),
			),
			"no-thread",
		);
	});
});
