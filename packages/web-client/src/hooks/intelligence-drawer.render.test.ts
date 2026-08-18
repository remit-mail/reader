/**
 * The intelligence drawer is modal, so what matters as much as opening it is
 * that nothing else can. It belongs to the thread it was opened for: leaving
 * that thread puts it away, and coming back to the same message opens it clear
 * rather than under the scrim it was last left with (#778).
 *
 * The reachable case is a phone's system Back, which is a navigation like any
 * other — the thread goes, and the drawer has to go with it for good.
 */

import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import { createElement } from "react";
import { createDomHarness, type DomHarness } from "../test-support/dom";
import { useIntelligenceDrawer } from "./useIntelligenceDrawer";

let dom: DomHarness;

beforeEach(() => {
	dom = createDomHarness();
});

afterEach(() => {
	dom.close();
});

/** Reports what the drawer says, and offers the controls a reader has. */
const Probe = ({ threadId }: { threadId: string | null }) => {
	const drawer = useIntelligenceDrawer(threadId);
	return createElement(
		"div",
		null,
		createElement(
			"span",
			{ "data-state": "" },
			drawer.isOpen ? "open" : "shut",
		),
		createElement("button", {
			type: "button",
			"data-open": "",
			onClick: drawer.open,
		}),
		createElement("button", {
			type: "button",
			"data-toggle": "",
			onClick: drawer.toggle,
		}),
	);
};

const state = (): string | undefined =>
	dom.query("[data-state]")?.textContent ?? undefined;
const press = (handle: string): void => {
	const button = dom.query(`[${handle}]`);
	if (!button) throw new Error(`no ${handle} control`);
	dom.click(button);
};

describe("the intelligence drawer", () => {
	it("opens only when it is asked to", () => {
		dom.render(createElement(Probe, { threadId: "thread-a" }));
		assert.equal(state(), "shut");

		press("data-open");
		assert.equal(state(), "open");
	});

	it("does not come back with the message it was opened over", () => {
		dom.render(createElement(Probe, { threadId: "thread-a" }));
		press("data-open");
		assert.equal(state(), "open");

		// System Back: the thread closes under it.
		dom.render(createElement(Probe, { threadId: null }));
		assert.equal(state(), "shut");

		// And the same message again, which is where the scrim used to be waiting.
		dom.render(createElement(Probe, { threadId: "thread-a" }));
		assert.equal(state(), "shut");
	});

	it("stays behind when the reader moves to another thread", () => {
		dom.render(createElement(Probe, { threadId: "thread-a" }));
		press("data-open");
		assert.equal(state(), "open");

		dom.render(createElement(Probe, { threadId: "thread-b" }));
		assert.equal(state(), "shut");
	});

	it("toggles shut again from the toolbar's control", () => {
		dom.render(createElement(Probe, { threadId: "thread-a" }));
		press("data-toggle");
		assert.equal(state(), "open");

		press("data-toggle");
		assert.equal(state(), "shut");
	});
});
