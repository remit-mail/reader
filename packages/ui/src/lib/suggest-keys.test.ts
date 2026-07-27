import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { suggestKeyAction } from "./suggest-keys.js";

const state = (overrides: Partial<Parameters<typeof suggestKeyAction>[0]>) => ({
	key: "ArrowDown",
	open: true,
	count: 3,
	activeIndex: -1,
	...overrides,
});

describe("suggestKeyAction", () => {
	it("consumes nothing while the list is closed", () => {
		for (const key of ["ArrowDown", "ArrowUp", "Enter", "Escape"]) {
			assert.deepEqual(suggestKeyAction(state({ key, open: false })), {
				type: "none",
			});
		}
	});

	it("consumes nothing when the list is empty", () => {
		assert.deepEqual(suggestKeyAction(state({ count: 0 })), { type: "none" });
	});

	it("moves down from the typed value into the first option", () => {
		assert.deepEqual(suggestKeyAction(state({ key: "ArrowDown" })), {
			type: "move",
			index: 0,
		});
	});

	it("wraps down off the end and up off the start", () => {
		assert.deepEqual(
			suggestKeyAction(state({ key: "ArrowDown", activeIndex: 2 })),
			{ type: "move", index: 0 },
		);
		assert.deepEqual(
			suggestKeyAction(state({ key: "ArrowUp", activeIndex: 0 })),
			{ type: "move", index: 2 },
		);
	});

	it("moves up from the typed value into the last option", () => {
		assert.deepEqual(suggestKeyAction(state({ key: "ArrowUp" })), {
			type: "move",
			index: 2,
		});
	});

	it("takes the highlighted suggestion on Enter", () => {
		assert.deepEqual(
			suggestKeyAction(state({ key: "Enter", activeIndex: 1 })),
			{ type: "accept", index: 1 },
		);
	});

	it("leaves Enter alone when nothing is highlighted, so the typed value stands", () => {
		assert.deepEqual(suggestKeyAction(state({ key: "Enter" })), {
			type: "none",
		});
	});

	it("takes the highlighted suggestion on a caller's extra accept keys", () => {
		assert.deepEqual(
			suggestKeyAction(
				state({ key: "Tab", activeIndex: 0, acceptKeys: ["Tab", ","] }),
			),
			{ type: "accept", index: 0 },
		);
		assert.deepEqual(
			suggestKeyAction(
				state({ key: ",", activeIndex: 0, acceptKeys: ["Tab", ","] }),
			),
			{ type: "accept", index: 0 },
		);
	});

	it("leaves a key nobody declared alone", () => {
		assert.deepEqual(suggestKeyAction(state({ key: "Tab", activeIndex: 0 })), {
			type: "none",
		});
	});

	it("dismisses on Escape whatever is highlighted", () => {
		assert.deepEqual(suggestKeyAction(state({ key: "Escape" })), {
			type: "dismiss",
		});
		assert.deepEqual(
			suggestKeyAction(state({ key: "Escape", activeIndex: 2 })),
			{ type: "dismiss" },
		);
	});

	it("ignores a stale highlight past the end of a shortened list", () => {
		assert.deepEqual(
			suggestKeyAction(state({ key: "Enter", count: 1, activeIndex: 2 })),
			{ type: "none" },
		);
	});
});
