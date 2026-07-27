/**
 * The reading pane following the keyboard cursor.
 *
 * Three properties keep it from being a request per keystroke or a surprise
 * open: a held key coalesces into one load for the row it stops on, following is
 * off while a selection is being built, and a move made while it was off is
 * spent rather than deferred — so turning following back on opens nothing until
 * the cursor moves again.
 */

import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { createElement } from "react";
import { createDomHarness, type DomHarness } from "../test-support/dom";
import {
	FOLLOW_FOCUS_DELAY_MS,
	useFollowFocusOpen,
} from "./useFollowFocusOpen";

let harness: DomHarness | undefined;

afterEach(() => {
	harness?.close();
	harness = undefined;
});

const DELAY = 20;

interface ProbeProps {
	keyboardFocusedMessageId: string | undefined;
	openMessageId: string | undefined;
	enabled: boolean;
	open: (messageId: string) => void;
	delayMs: number;
}

function Probe(props: ProbeProps) {
	useFollowFocusOpen(props);
	return null;
}

interface Driver {
	/** Re-render with a new cursor state, as a keypress would. */
	move: (props: Partial<ProbeProps>) => void;
	/** Let the settle timer fire — twice over, so a missed load still shows. */
	settle: () => Promise<void>;
	wait: (ms: number) => Promise<void>;
	opened: string[];
}

const mount = (initial: Partial<ProbeProps> = {}, delayMs = DELAY): Driver => {
	const opened: string[] = [];
	let props: ProbeProps = {
		keyboardFocusedMessageId: undefined,
		openMessageId: undefined,
		enabled: true,
		open: (messageId) => opened.push(messageId),
		delayMs,
		...initial,
	};
	const dom = createDomHarness();
	harness = dom;
	const paint = () => dom.render(createElement(Probe, props));
	paint();
	return {
		opened,
		move: (next) => {
			props = { ...props, ...next };
			paint();
		},
		settle: () => dom.wait(delayMs * 2),
		wait: (ms) => dom.wait(ms),
	};
};

describe("useFollowFocusOpen", () => {
	it("opens the row the cursor lands on", async () => {
		const driver = mount();
		driver.move({ keyboardFocusedMessageId: "m1" });
		await driver.settle();
		assert.deepEqual(driver.opened, ["m1"]);
	});

	it("opens nothing until the cursor has settled", async () => {
		const driver = mount();
		driver.move({ keyboardFocusedMessageId: "m1" });
		assert.deepEqual(driver.opened, []);
	});

	it("coalesces a held key into one load, for the row it stops on", async () => {
		const driver = mount();
		for (const id of ["m1", "m2", "m3", "m4"])
			driver.move({ keyboardFocusedMessageId: id });
		await driver.settle();
		assert.deepEqual(driver.opened, ["m4"]);
	});

	it("does not re-arm on a re-render that changes only the opener's identity", async () => {
		// A long delay so the re-render lands mid-flight with room to spare: a
		// re-arm would push the load out past the total wait below, which is what
		// permanently defers it while a list re-renders.
		const driver = mount({}, 100);
		driver.move({ keyboardFocusedMessageId: "m1" });
		await driver.wait(60);
		// A list passes an inline opener, so every render hands in a new function.
		driver.move({ open: (messageId) => driver.opened.push(messageId) });
		await driver.wait(60);
		assert.deepEqual(driver.opened, ["m1"]);
	});

	it("does not reload the row already in the reading pane", async () => {
		const driver = mount({ openMessageId: "m1" });
		driver.move({ keyboardFocusedMessageId: "m1" });
		await driver.settle();
		assert.deepEqual(driver.opened, []);
	});

	it("opens nothing while rows are selected", async () => {
		const driver = mount({ enabled: false });
		driver.move({ keyboardFocusedMessageId: "m1" });
		await driver.settle();
		assert.deepEqual(driver.opened, []);
	});

	it("spends the move made while following was off rather than deferring it", async () => {
		const driver = mount({ enabled: false });
		driver.move({ keyboardFocusedMessageId: "m1" });
		await driver.settle();

		// Clearing the selection must not load whatever row the cursor happens to
		// be sitting on.
		driver.move({ enabled: true });
		await driver.settle();
		assert.deepEqual(driver.opened, []);

		// The next move is a fresh one and does load.
		driver.move({ keyboardFocusedMessageId: "m2" });
		await driver.settle();
		assert.deepEqual(driver.opened, ["m2"]);
	});

	it("opens nothing when the cursor moved some way other than the keyboard", async () => {
		const driver = mount();
		driver.move({ keyboardFocusedMessageId: undefined });
		await driver.settle();
		assert.deepEqual(driver.opened, []);
	});
});

describe("FOLLOW_FOCUS_DELAY_MS", () => {
	it("sits above key repeat and below what reads as a wait", () => {
		assert.ok(FOLLOW_FOCUS_DELAY_MS >= 60);
		assert.ok(FOLLOW_FOCUS_DELAY_MS <= 250);
	});
});
