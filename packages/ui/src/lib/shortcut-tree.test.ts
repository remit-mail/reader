import assert from "node:assert";
import { describe, test } from "node:test";
import { ALL_TRIAGE_ACTIONS, type TriageAction } from "./keymap.js";
import {
	type BlockedReason,
	type DetailSurface,
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
const inbox: MailList = { kind: "mailbox", mailboxId: "a", role: "inbox" };
const sent: MailList = { kind: "mailbox", mailboxId: "b", role: "sent" };
const archive: MailList = { kind: "mailbox", mailboxId: "c", role: "other" };

const thread: DetailSurface = {
	kind: "thread",
	threadId: "t1",
	messageId: null,
};
const draft: DetailSurface = { kind: "compose", draftId: null };

const aim = { threadId: "t1", messageId: null };

const listOnly = (partial: Partial<ListNode> = {}): ListNode => ({
	list: brief,
	pane: { layout: "list-only" },
	aim: null,
	selection: [],
	...partial,
});

const split = (
	surface: DetailSurface,
	partial: Partial<ListNode> = {},
): ListNode => ({
	...listOnly({ aim, ...partial }),
	pane: { layout: "split", detail: { surface } },
});

const detailOnly = (
	surface: DetailSurface,
	partial: Partial<ListNode> = {},
): ListNode => ({
	...listOnly({ aim, ...partial }),
	pane: { layout: "detail-only", detail: { surface } },
});

const tree = (partial: Partial<ShortcutTree> = {}): ShortcutTree => ({
	overlays: [],
	editing: null,
	settling: null,
	mail: { list: listOnly() },
	...partial,
});

const on = (list: ListNode): ShortcutTree => tree({ mail: { list } });

const settings = (): ShortcutTree => tree({ mail: null });

const everywhere: RegisteredActions = {
	app: ALL_TRIAGE_ACTIONS,
	mail: ALL_TRIAGE_ACTIONS,
	list: ALL_TRIAGE_ACTIONS,
	detail: ALL_TRIAGE_ACTIONS,
};

const acted = (result: Resolution): string => {
	if (result.outcome !== "act") {
		assert.fail(`expected act, got ${result.outcome}`);
	}
	if (result.target.kind === "level") return result.target.level;
	if (result.target.kind === "overlay") {
		return `overlay:${result.target.frame.id}`;
	}
	return `editing:${result.target.field.id}`;
};

const containedBy = (result: Resolution): string => {
	if (result.outcome !== "contained") {
		assert.fail(`expected contained, got ${result.outcome}`);
	}
	if (result.by.kind === "overlay") return `overlay:${result.by.frame.id}`;
	return `editing:${result.by.field.id}`;
};

const blockedFor = (result: Resolution): string => {
	if (result.outcome !== "blocked") {
		assert.fail(`expected blocked, got ${result.outcome}`);
	}
	return result.reason;
};

describe("shortcut tree", () => {
	test("every declared action is one the keymap can produce", () => {
		const known = new Set<string>(ALL_TRIAGE_ACTIONS);
		for (const rules of Object.values(NODE_ACTIONS)) {
			for (const declared of rules) {
				assert.ok(known.has(declared.action), `${declared.action} is known`);
			}
		}
	});

	test("every keymap action is declared somewhere in the tree", () => {
		const declared = new Set<string>(
			Object.values(NODE_ACTIONS).flatMap((rules) =>
				rules.map((entry) => entry.action),
			),
		);
		for (const action of ALL_TRIAGE_ACTIONS) {
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

	test("an overlay contains what it does not handle", () => {
		const withOverlay = tree({
			overlays: [{ id: "confirm", handles: ["back"] }],
		});
		assert.strictEqual(
			containedBy(resolveShortcut("selectAll", withOverlay, everywhere)),
			"overlay:confirm",
		);
		assert.strictEqual(
			containedBy(resolveShortcut("focusSearch", withOverlay, everywhere)),
			"overlay:confirm",
		);
	});

	test("an editing field answers or contains, and pre-empts the levels", () => {
		const editing: EditingField = { id: "search", handles: ["back"] };
		const typing = tree({ editing });
		assert.strictEqual(
			acted(resolveShortcut("back", typing, everywhere)),
			"editing:search",
		);
		assert.strictEqual(
			containedBy(resolveShortcut("focusNext", typing, everywhere)),
			"editing:search",
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
		for (const action of ALL_TRIAGE_ACTIONS) {
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

	test("focusNext walks to the list when the list shares the screen", () => {
		const desktop = on(split(thread));
		assert.strictEqual(
			acted(resolveShortcut("focusNext", desktop, everywhere)),
			"list",
		);
		assert.strictEqual(
			acted(resolveShortcut("focusPrevious", desktop, everywhere)),
			"list",
		);
	});

	test("focusNext stops at the detail when the detail owns the screen", () => {
		const phone = on(detailOnly(thread));
		assert.strictEqual(
			acted(resolveShortcut("focusNext", phone, everywhere)),
			"detail",
		);
		assert.strictEqual(
			acted(resolveShortcut("focusPrevious", phone, everywhere)),
			"detail",
		);
	});

	test("a level that serves an action but registers no handler is skipped", () => {
		const phone = on(detailOnly(thread));
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

	test("an action no level serves is unbound, requirements or not", () => {
		assert.strictEqual(
			resolveShortcut("compose", tree(), {}).outcome,
			"unbound",
		);
		assert.strictEqual(
			resolveShortcut("muteSender", tree(), {}).outcome,
			"unbound",
		);
		assert.strictEqual(
			resolveShortcut("toggleSelect", on(detailOnly(thread)), {}).outcome,
			"unbound",
		);
	});

	test("an unmet requirement only speaks when the level serves the action", () => {
		const unaimed = on(listOnly());
		assert.strictEqual(
			resolveShortcut("muteSender", unaimed, {}).outcome,
			"unbound",
		);
		assert.strictEqual(
			blockedFor(
				resolveShortcut("muteSender", unaimed, { list: ["muteSender"] }),
			),
			"not-aimed",
		);
	});

	test("the root-most served level's reason is the one reported", () => {
		const composing = on(split(draft, { aim: null }));
		assert.strictEqual(
			blockedFor(
				resolveShortcut("reply", composing, {
					detail: ["reply"],
					list: ["reply"],
				}),
			),
			"not-aimed",
		);
	});

	test("back closes a compose detail, which is not a thread", () => {
		const composing = on(detailOnly(draft));
		assert.strictEqual(
			acted(resolveShortcut("back", composing, everywhere)),
			"detail",
		);
		assert.strictEqual(
			blockedFor(resolveShortcut("reply", composing, { detail: ["reply"] })),
			"no-thread",
		);
	});

	test("back clears a selection on the list", () => {
		assert.strictEqual(
			blockedFor(resolveShortcut("back", on(listOnly()), everywhere)),
			"no-selection",
		);
		assert.strictEqual(
			acted(
				resolveShortcut(
					"back",
					on(listOnly({ selection: ["m1"] })),
					everywhere,
				),
			),
			"list",
		);
	});

	test("a phone thread reports geometry, not a fault", () => {
		const phone = on(detailOnly(thread));
		for (const action of [
			"toggleSelect",
			"selectAll",
			"toggleDensity",
			"openFocused",
			"focusFirst",
			"focusLast",
		] as TriageAction[]) {
			assert.strictEqual(
				blockedFor(resolveShortcut(action, phone, everywhere)),
				"list-off-screen",
			);
		}
	});

	test("go-to keys know where they already are", () => {
		assert.strictEqual(
			blockedFor(resolveShortcut("goBrief", on(listOnly()), everywhere)),
			"already-there",
		);
		assert.strictEqual(
			blockedFor(
				resolveShortcut(
					"goFlagged",
					on(listOnly({ list: { kind: "flagged" } })),
					everywhere,
				),
			),
			"already-there",
		);
		assert.strictEqual(
			blockedFor(
				resolveShortcut("goInbox", on(listOnly({ list: inbox })), everywhere),
			),
			"already-there",
		);
		assert.strictEqual(
			blockedFor(
				resolveShortcut("goSent", on(listOnly({ list: sent })), everywhere),
			),
			"already-there",
		);
	});

	test("a mailbox with no role is somewhere else entirely", () => {
		const other = on(listOnly({ list: archive }));
		assert.strictEqual(
			acted(resolveShortcut("goInbox", other, everywhere)),
			"app",
		);
		assert.strictEqual(
			acted(resolveShortcut("goSent", other, everywhere)),
			"app",
		);
		assert.strictEqual(
			acted(resolveShortcut("goBrief", other, everywhere)),
			"app",
		);
	});

	test("a go-to key outside any list is not already-there", () => {
		const noList = tree({ mail: { list: null } });
		assert.strictEqual(
			acted(resolveShortcut("goBrief", noList, everywhere)),
			"app",
		);
		assert.strictEqual(
			acted(resolveShortcut("goBrief", settings(), everywhere)),
			"app",
		);
	});

	test("help and the go-to family answer on a screen with no mail node", () => {
		const globals: TriageAction[] = [
			"help",
			"goBrief",
			"goFlagged",
			"goInbox",
			"goSent",
			"goSettings",
		];
		for (const action of globals) {
			assert.strictEqual(
				acted(resolveShortcut(action, settings(), everywhere)),
				"app",
			);
		}
	});

	test("the mail surface's own keys are dead where there is no mail", () => {
		const mailOnly: TriageAction[] = [
			"compose",
			"focusSearch",
			"toggleIntelligence",
		];
		for (const action of mailOnly) {
			assert.strictEqual(
				resolveShortcut(action, settings(), everywhere).outcome,
				"unbound",
			);
			assert.strictEqual(
				acted(resolveShortcut(action, tree(), everywhere)),
				"mail",
			);
		}
	});

	test("every blocked reason is reachable", () => {
		const scenarios: Record<BlockedReason, () => Resolution> = {
			settling: () =>
				resolveShortcut("help", tree({ settling: "app" }), everywhere),
			"list-settling": () =>
				resolveShortcut("help", tree({ settling: "list" }), everywhere),
			"list-off-screen": () =>
				resolveShortcut("toggleSelect", on(detailOnly(thread)), {
					list: ["toggleSelect"],
				}),
			"list-shown": () =>
				resolveShortcut("focusNext", on(split(thread)), {
					detail: ["focusNext"],
				}),
			"not-aimed": () =>
				resolveShortcut("toggleStar", on(listOnly()), { list: ["toggleStar"] }),
			"no-selection": () =>
				resolveShortcut("back", on(listOnly()), { list: ["back"] }),
			"no-thread": () =>
				resolveShortcut("reply", on(detailOnly(draft)), { detail: ["reply"] }),
			"already-there": () =>
				resolveShortcut("goBrief", on(listOnly()), { app: ["goBrief"] }),
		};
		for (const [reason, scenario] of Object.entries(scenarios)) {
			assert.strictEqual(blockedFor(scenario()), reason);
		}
	});
});
