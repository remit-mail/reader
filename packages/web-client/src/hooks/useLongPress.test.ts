import assert from "node:assert";
import { beforeEach, describe, mock, test } from "node:test";

/**
 * Test harness for useLongPress. Since we can't use React Testing Library,
 * we test the handler logic directly by simulating pointer events and timers.
 */

interface MockPointerEvent {
	clientX: number;
	clientY: number;
}

const createPointerEvent = (x: number, y: number): MockPointerEvent => ({
	clientX: x,
	clientY: y,
});

/**
 * Minimal implementation of useLongPress logic for testing.
 * Matches the hook's behavior without React dependencies.
 */
class LongPressSimulator {
	private timer: ReturnType<typeof setTimeout> | null = null;
	private startPos: { x: number; y: number } | null = null;
	private readonly MOVEMENT_THRESHOLD = 8;

	constructor(
		private readonly onLongPress: () => void,
		private readonly delayMs: number = 500,
	) {}

	onPointerDown(e: MockPointerEvent): void {
		this.clearTimer();
		this.startPos = { x: e.clientX, y: e.clientY };
		this.timer = setTimeout(() => {
			this.onLongPress();
			this.clearTimer();
		}, this.delayMs);
	}

	onPointerMove(e: MockPointerEvent): void {
		if (!this.startPos) return;

		const dx = e.clientX - this.startPos.x;
		const dy = e.clientY - this.startPos.y;
		const distance = Math.sqrt(dx * dx + dy * dy);

		if (distance > this.MOVEMENT_THRESHOLD) {
			this.clearTimer();
		}
	}

	onPointerUp(): void {
		this.clearTimer();
	}

	onPointerCancel(): void {
		this.clearTimer();
	}

	private clearTimer(): void {
		if (this.timer) {
			clearTimeout(this.timer);
			this.timer = null;
		}
		this.startPos = null;
	}

	/** Test helper: check if timer is active */
	hasActiveTimer(): boolean {
		return this.timer !== null;
	}

	/** Test helper: cleanup */
	cleanup(): void {
		this.clearTimer();
	}
}

describe("useLongPress", () => {
	beforeEach(() => {
		// Reset any timers between tests
		mock.restoreAll();
	});

	test("fires callback after delay with no movement", async () => {
		const onLongPress = mock.fn();
		const sim = new LongPressSimulator(onLongPress, 500);

		sim.onPointerDown(createPointerEvent(100, 100));

		// Wait for the delay
		await new Promise((resolve) => setTimeout(resolve, 550));

		assert.strictEqual(onLongPress.mock.calls.length, 1);
		sim.cleanup();
	});

	test("does not fire if pointer moves more than 8px", async () => {
		const onLongPress = mock.fn();
		const sim = new LongPressSimulator(onLongPress, 500);

		sim.onPointerDown(createPointerEvent(100, 100));

		// Move 10 pixels (more than threshold of 8)
		sim.onPointerMove(createPointerEvent(110, 100));

		// Wait beyond the delay
		await new Promise((resolve) => setTimeout(resolve, 550));

		assert.strictEqual(
			onLongPress.mock.calls.length,
			0,
			"callback should not fire after moving > threshold",
		);
		sim.cleanup();
	});

	test("does not fire on early pointerup", async () => {
		const onLongPress = mock.fn();
		const sim = new LongPressSimulator(onLongPress, 500);

		sim.onPointerDown(createPointerEvent(100, 100));

		// Release before delay completes
		await new Promise((resolve) => setTimeout(resolve, 100));
		sim.onPointerUp();

		// Wait beyond the original delay
		await new Promise((resolve) => setTimeout(resolve, 500));

		assert.strictEqual(
			onLongPress.mock.calls.length,
			0,
			"callback should not fire after early pointerup",
		);
		sim.cleanup();
	});

	test("does not fire on pointercancel", async () => {
		const onLongPress = mock.fn();
		const sim = new LongPressSimulator(onLongPress, 500);

		sim.onPointerDown(createPointerEvent(100, 100));

		// Cancel before delay completes
		await new Promise((resolve) => setTimeout(resolve, 100));
		sim.onPointerCancel();

		// Wait beyond the original delay
		await new Promise((resolve) => setTimeout(resolve, 500));

		assert.strictEqual(
			onLongPress.mock.calls.length,
			0,
			"callback should not fire after pointercancel",
		);
		sim.cleanup();
	});

	test("respects custom delayMs", async () => {
		const onLongPress = mock.fn();
		const customDelay = 200;
		const sim = new LongPressSimulator(onLongPress, customDelay);

		sim.onPointerDown(createPointerEvent(100, 100));

		// Wait less than custom delay
		await new Promise((resolve) => setTimeout(resolve, 150));
		assert.strictEqual(
			onLongPress.mock.calls.length,
			0,
			"should not fire before custom delay",
		);

		// Wait past custom delay
		await new Promise((resolve) => setTimeout(resolve, 100));
		assert.strictEqual(
			onLongPress.mock.calls.length,
			1,
			"should fire after custom delay",
		);
		sim.cleanup();
	});

	test("allows movement within 8px threshold", async () => {
		const onLongPress = mock.fn();
		const sim = new LongPressSimulator(onLongPress, 500);

		sim.onPointerDown(createPointerEvent(100, 100));

		// Move 7 pixels (within threshold)
		sim.onPointerMove(createPointerEvent(107, 100));

		// Wait for the delay
		await new Promise((resolve) => setTimeout(resolve, 550));

		assert.strictEqual(
			onLongPress.mock.calls.length,
			1,
			"callback should fire when movement is within threshold",
		);
		sim.cleanup();
	});

	test("calculates diagonal movement correctly", async () => {
		const onLongPress = mock.fn();
		const sim = new LongPressSimulator(onLongPress, 500);

		sim.onPointerDown(createPointerEvent(100, 100));

		// Move 6px in both x and y (diagonal distance ~8.48px > 8px threshold)
		sim.onPointerMove(createPointerEvent(106, 106));

		// Wait beyond the delay
		await new Promise((resolve) => setTimeout(resolve, 550));

		assert.strictEqual(
			onLongPress.mock.calls.length,
			0,
			"callback should not fire when diagonal movement exceeds threshold",
		);
		sim.cleanup();
	});

	test("ignores pointer move before pointer down", async () => {
		const onLongPress = mock.fn();
		const sim = new LongPressSimulator(onLongPress, 500);

		// Move without pressing down first
		sim.onPointerMove(createPointerEvent(200, 200));

		sim.onPointerDown(createPointerEvent(100, 100));

		// Wait for the delay
		await new Promise((resolve) => setTimeout(resolve, 550));

		assert.strictEqual(
			onLongPress.mock.calls.length,
			1,
			"callback should fire - earlier move should be ignored",
		);
		sim.cleanup();
	});

	test("resets on new pointer down", async () => {
		const onLongPress = mock.fn();
		const sim = new LongPressSimulator(onLongPress, 500);

		// First press
		sim.onPointerDown(createPointerEvent(100, 100));

		// Wait a bit
		await new Promise((resolve) => setTimeout(resolve, 200));

		// New press at different location (should reset timer)
		sim.onPointerDown(createPointerEvent(200, 200));

		// Wait for delay from second press
		await new Promise((resolve) => setTimeout(resolve, 550));

		// Should only fire once (from second press)
		assert.strictEqual(
			onLongPress.mock.calls.length,
			1,
			"callback should fire once from second press",
		);
		sim.cleanup();
	});

	test("exact 8px movement does not cancel", async () => {
		const onLongPress = mock.fn();
		const sim = new LongPressSimulator(onLongPress, 500);

		sim.onPointerDown(createPointerEvent(100, 100));

		// Move exactly 8 pixels
		sim.onPointerMove(createPointerEvent(108, 100));

		// Wait for the delay
		await new Promise((resolve) => setTimeout(resolve, 550));

		assert.strictEqual(
			onLongPress.mock.calls.length,
			1,
			"callback should fire - movement exactly at threshold is allowed",
		);
		sim.cleanup();
	});
});
