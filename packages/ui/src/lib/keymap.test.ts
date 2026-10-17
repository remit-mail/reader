import assert from "node:assert";
import { describe, test } from "node:test";
import {
	ALL_TRIAGE_ACTIONS,
	KEY_HINT_GROUPS,
	keysForAction,
	shortcutHintForAction,
	tooltipForAction,
} from "./keymap.js";

describe("keymap module", () => {
	test("keysForAction returns the first hint's tokens", () => {
		assert.deepStrictEqual(keysForAction("reply"), ["r"]);
		assert.deepStrictEqual(keysForAction("goBrief"), ["g", "b"]);
	});

	test("tooltipForAction renders single keys, sequences and combos", () => {
		assert.strictEqual(tooltipForAction("reply"), "(r)");
		assert.strictEqual(tooltipForAction("goBrief"), "(g then b)");
		// compose's first hint is the single 'c' key.
		assert.strictEqual(tooltipForAction("compose"), "(c)");
	});

	test("shortcutHintForAction renders the binding without the parens", () => {
		assert.strictEqual(shortcutHintForAction("reply"), "r");
		assert.strictEqual(shortcutHintForAction("goBrief"), "g then b");
		assert.strictEqual(shortcutHintForAction("compose"), "c");
	});

	test("an action with no binding gets no hint and no empty parens", () => {
		const unbound = "totallyMissing" as Parameters<
			typeof shortcutHintForAction
		>[0];
		assert.strictEqual(shortcutHintForAction(unbound), "");
		assert.strictEqual(tooltipForAction(unbound), "");
	});

	test("the navigation hints name a direction on screen, not a place in time", () => {
		const navigation = KEY_HINT_GROUPS.find((g) => g.title === "Navigation");
		assert.ok(navigation, "the Navigation group is declared");

		const describes = (key: string): string | undefined =>
			navigation.hints.find((hint) => hint.keys.join("") === key)?.description;

		// Both surfaces the keys serve read downward, and a conversation reads
		// newest first — so down is back in time there. A description saying
		// "next message" is read as the newer one, which is the opposite.
		assert.strictEqual(describes("j"), "Focus the message below");
		assert.strictEqual(describes("↓"), "Focus the message below");
		assert.strictEqual(describes("k"), "Focus the message above");
		assert.strictEqual(describes("↑"), "Focus the message above");
	});

	test("every action the app can produce has a displayed binding", () => {
		for (const action of ALL_TRIAGE_ACTIONS) {
			assert.ok(keysForAction(action), `${action} has keys`);
		}
	});
});
