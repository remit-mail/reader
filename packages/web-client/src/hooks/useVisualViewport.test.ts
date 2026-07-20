import assert from "node:assert";
import { beforeEach, describe, test } from "node:test";

/**
 * Unit test for useVisualViewport hook logic.
 * Tests the core behaviour without React.
 */

const KEYBOARD_THRESHOLD = 150;

interface ViewportState {
	viewportHeight: number;
	isKeyboardOpen: boolean;
}

/**
 * Simulates the viewport-tracking logic from useVisualViewport.
 */
class VisualViewportSimulator {
	private innerHeight: number;
	private viewportHeight: number;
	private listeners: Array<() => void> = [];

	constructor(innerHeight: number) {
		this.innerHeight = innerHeight;
		this.viewportHeight = innerHeight;
	}

	getState(): ViewportState {
		return {
			viewportHeight: this.viewportHeight,
			isKeyboardOpen:
				this.innerHeight - this.viewportHeight > KEYBOARD_THRESHOLD,
		};
	}

	/** Simulate a visualViewport resize (e.g. keyboard appearing). */
	resize(newViewportHeight: number): ViewportState {
		this.viewportHeight = newViewportHeight;
		for (const fn of this.listeners) fn();
		return this.getState();
	}

	addListener(fn: () => void): void {
		this.listeners.push(fn);
	}

	removeListener(fn: () => void): void {
		this.listeners = this.listeners.filter((l) => l !== fn);
	}

	get listenerCount(): number {
		return this.listeners.length;
	}
}

describe("useVisualViewport logic", () => {
	let sim: VisualViewportSimulator;

	beforeEach(() => {
		// iPhone-like viewport: 844px tall
		sim = new VisualViewportSimulator(844);
	});

	test("initial state has keyboard closed", () => {
		const state = sim.getState();
		assert.strictEqual(state.viewportHeight, 844);
		assert.strictEqual(state.isKeyboardOpen, false);
	});

	test("keyboard open when viewport shrinks by more than threshold", () => {
		// Typical iOS keyboard: viewport shrinks to ~400px
		const state = sim.resize(400);
		assert.strictEqual(state.isKeyboardOpen, true);
		assert.strictEqual(state.viewportHeight, 400);
	});

	test("keyboard stays closed for small viewport changes", () => {
		// Address bar collapsing — only ~50px change
		const state = sim.resize(794);
		assert.strictEqual(state.isKeyboardOpen, false);
	});

	test("keyboard closes when viewport restores", () => {
		sim.resize(400);
		const state = sim.resize(844);
		assert.strictEqual(state.isKeyboardOpen, false);
		assert.strictEqual(state.viewportHeight, 844);
	});

	test("exactly at threshold boundary — not open", () => {
		// innerHeight - viewportHeight === 150, not > 150
		const state = sim.resize(844 - KEYBOARD_THRESHOLD);
		assert.strictEqual(state.isKeyboardOpen, false);
	});

	test("one pixel past threshold — keyboard open", () => {
		const state = sim.resize(844 - KEYBOARD_THRESHOLD - 1);
		assert.strictEqual(state.isKeyboardOpen, true);
	});

	test("listeners are called on resize", () => {
		let callCount = 0;
		sim.addListener(() => {
			callCount++;
		});
		sim.resize(400);
		sim.resize(844);
		assert.strictEqual(callCount, 2);
	});

	test("removeListener stops notifications", () => {
		let callCount = 0;
		const fn = () => {
			callCount++;
		};
		sim.addListener(fn);
		sim.resize(400);
		assert.strictEqual(callCount, 1);

		sim.removeListener(fn);
		sim.resize(844);
		assert.strictEqual(callCount, 1);
		assert.strictEqual(sim.listenerCount, 0);
	});
});
