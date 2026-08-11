import assert from "node:assert";
import { describe, test } from "node:test";
import {
	KEY_HINT_GROUPS,
	keysForAction,
	shortcutHintForAction,
	tooltipForAction,
} from "./keymap.js";

describe("keymap module", () => {
	test("exposes the documented groups in reading order", () => {
		const titles = KEY_HINT_GROUPS.map((g) => g.title);
		assert.deepStrictEqual(titles, [
			"Navigation",
			"Selection",
			"Actions",
			"Sender",
			"Go to",
			"View & global",
		]);
	});

	test("keysForAction returns the first hint's tokens", () => {
		assert.deepStrictEqual(keysForAction("reply"), ["r"]);
		assert.deepStrictEqual(keysForAction("goBrief"), ["g", "b"]);
	});

	test("keysForAction is undefined for an action with no hint", () => {
		// `back` has a hint; a contrived missing lookup returns undefined.
		assert.strictEqual(
			keysForAction("totallyMissing" as Parameters<typeof keysForAction>[0]),
			undefined,
		);
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

	test("every hint's action is a non-empty key list", () => {
		for (const group of KEY_HINT_GROUPS) {
			for (const hint of group.hints) {
				assert.ok(hint.keys.length > 0, `${hint.action} has keys`);
				assert.ok(
					hint.description.length > 0,
					`${hint.action} has a description`,
				);
			}
		}
	});
});
