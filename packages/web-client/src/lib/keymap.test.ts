import assert from "node:assert";
import { describe, test } from "node:test";
import { KEY_HINT_GROUPS, keysForAction, tooltipForAction } from "./keymap.ts";

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
