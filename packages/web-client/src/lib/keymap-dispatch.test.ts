import assert from "node:assert";
import { describe, test } from "node:test";
import {
	dispatchKey,
	type KeyStroke,
	type SequencePrefix,
} from "./keymap-dispatch.ts";

const stroke = (partial: Partial<KeyStroke> & { key: string }): KeyStroke => ({
	shiftKey: false,
	metaKey: false,
	ctrlKey: false,
	altKey: false,
	inEditable: false,
	...partial,
});

const run = (
	s: Partial<KeyStroke> & { key: string },
	prefix: SequencePrefix = null,
) => dispatchKey(stroke(s), prefix);

describe("dispatchKey — plain bindings", () => {
	const cases: Array<[string, string]> = [
		["j", "focusNext"],
		["k", "focusPrevious"],
		["Enter", "openFocused"],
		["u", "toggleRead"],
		["x", "toggleSelect"],
		["r", "reply"],
		["a", "replyAll"],
		["f", "forward"],
		["#", "delete"],
		["s", "toggleStar"],
		["m", "muteSender"],
		["b", "blockSender"],
		["v", "vipSender"],
		["!", "markJunk"],
		["i", "toggleIntelligence"],
		["d", "toggleDensity"],
		["/", "focusSearch"],
		["c", "compose"],
		["?", "help"],
	];

	for (const [key, action] of cases) {
		test(`'${key}' → ${action}`, () => {
			const result = run({ key });
			assert.strictEqual(result.action, action);
			assert.strictEqual(result.nextPrefix, null);
		});
	}

	test("uppercase letters match case-insensitively", () => {
		assert.strictEqual(run({ key: "R", shiftKey: true }).action, null);
		assert.strictEqual(run({ key: "R" }).action, "reply");
	});

	test("unknown key maps to nothing", () => {
		assert.strictEqual(run({ key: "q" }).action, null);
	});
});

describe("dispatchKey — input suppression", () => {
	test("plain keys are inert in an editable surface", () => {
		assert.strictEqual(run({ key: "j", inEditable: true }).action, null);
		assert.strictEqual(run({ key: "e", inEditable: true }).action, null);
		assert.strictEqual(run({ key: "c", inEditable: true }).action, null);
	});

	test("Esc is inert in an editable surface (field owns its own Esc)", () => {
		// The layer must NOT emit `back` for Esc-while-typing: that would
		// double-fire with SearchBar's own Esc (clear query AND close thread).
		const result = run({ key: "Escape", inEditable: true });
		assert.strictEqual(result.action, null);
		assert.strictEqual(result.preventDefault, false);
	});

	test("Esc in an input clears a pending g prefix", () => {
		const result = run({ key: "Escape", inEditable: true }, "g");
		assert.strictEqual(result.action, null);
		assert.strictEqual(result.nextPrefix, null);
	});

	test("any key in an editable surface clears a pending g prefix", () => {
		// You can't be mid-`g`-sequence while typing in a field; entering an
		// editable surface drops any stale prefix so it can't leak back out.
		const result = run({ key: "x", inEditable: true }, "g");
		assert.strictEqual(result.action, null);
		assert.strictEqual(result.nextPrefix, null);
	});
});

describe("dispatchKey — modifiers", () => {
	test("⌘N / Ctrl+N → compose", () => {
		assert.strictEqual(run({ key: "n", metaKey: true }).action, "compose");
		assert.strictEqual(run({ key: "n", ctrlKey: true }).action, "compose");
	});

	test("other meta combos are left to the browser", () => {
		assert.strictEqual(run({ key: "a", metaKey: true }).action, null);
		assert.strictEqual(run({ key: "c", metaKey: true }).action, null);
	});

	test("Shift+J / Shift+K extend the selection", () => {
		assert.strictEqual(
			run({ key: "j", shiftKey: true }).action,
			"extendSelectDown",
		);
		assert.strictEqual(
			run({ key: "k", shiftKey: true }).action,
			"extendSelectUp",
		);
	});

	test("Shift on a letter verb suppresses it (no Shift+R reply)", () => {
		assert.strictEqual(run({ key: "r", shiftKey: true }).action, null);
		assert.strictEqual(run({ key: "e", shiftKey: true }).action, null);
	});

	test("Shift on a shifted-punctuation binding still fires (#, !, ?)", () => {
		assert.strictEqual(run({ key: "#", shiftKey: true }).action, "delete");
		assert.strictEqual(run({ key: "!", shiftKey: true }).action, "markJunk");
		assert.strictEqual(run({ key: "?", shiftKey: true }).action, "help");
	});
});

describe("dispatchKey — g … sequences", () => {
	test("g arms the prefix without an action", () => {
		const result = run({ key: "g" });
		assert.strictEqual(result.action, null);
		assert.strictEqual(result.nextPrefix, "g");
		assert.strictEqual(result.preventDefault, true);
	});

	const seq: Array<[string, string]> = [
		["b", "goBrief"],
		["i", "goInbox"],
		["s", "goSent"],
		["f", "goFlagged"],
		[",", "goSettings"],
	];
	for (const [key, action] of seq) {
		test(`g then '${key}' → ${action}`, () => {
			const result = run({ key }, "g");
			assert.strictEqual(result.action, action);
			assert.strictEqual(result.nextPrefix, null);
		});
	}

	test("g then an unmapped key cancels the prefix and is inert", () => {
		const result = run({ key: "q" }, "g");
		assert.strictEqual(result.action, null);
		assert.strictEqual(result.nextPrefix, null);
	});

	test("Shift+G does not arm the prefix", () => {
		assert.strictEqual(run({ key: "g", shiftKey: true }).nextPrefix, null);
	});

	test("after a sequence resolves, the next key is a plain binding again", () => {
		const first = run({ key: "g" });
		assert.strictEqual(first.nextPrefix, "g");
		const second = run({ key: "j" }, first.nextPrefix);
		// 'j' is not a go-to key → cancels, inert.
		assert.strictEqual(second.action, null);
		const third = run({ key: "j" }, second.nextPrefix);
		assert.strictEqual(third.action, "focusNext");
	});
});

describe("dispatchKey — escape", () => {
	test("Esc maps to back and clears any prefix", () => {
		const result = run({ key: "Escape" }, "g");
		assert.strictEqual(result.action, "back");
		assert.strictEqual(result.nextPrefix, null);
	});
});
