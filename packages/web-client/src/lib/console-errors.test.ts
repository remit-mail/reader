import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { install } from "./console-errors";
import { __resetFatalError, subscribeFatalError } from "./fatal-error";

type WindowListener = (event: unknown) => void;

interface WindowStub {
	listeners: Map<string, WindowListener>;
	addEventListener(type: string, listener: WindowListener): void;
}

function installWindowStub(): WindowStub {
	const stub: WindowStub = {
		listeners: new Map(),
		addEventListener(type, listener): void {
			this.listeners.set(type, listener);
		},
	};
	(globalThis as unknown as { window: WindowStub }).window = stub;
	return stub;
}

function emitWindowError(stub: WindowStub, message: string): void {
	const handler = stub.listeners.get("error");
	assert.ok(handler, "install() should register a window error handler");
	handler({ message, error: null, filename: "app.js", lineno: 0 });
}

describe("console-errors window error handling", () => {
	const originalConsoleError = console.error;

	afterEach(() => {
		__resetFatalError();
		console.error = originalConsoleError;
		delete (globalThis as unknown as { window?: unknown }).window;
	});

	it("does not escalate benign ResizeObserver noise", () => {
		const stub = installWindowStub();
		const escalated: string[] = [];
		subscribeFatalError((fatal) => escalated.push(fatal.message));
		install();

		emitWindowError(stub, "ResizeObserver loop limit exceeded");
		emitWindowError(
			stub,
			"ResizeObserver loop completed with undelivered notifications.",
		);

		assert.deepEqual(escalated, []);
	});

	it("escalates an arbitrary uncaught error", () => {
		const stub = installWindowStub();
		const escalated: string[] = [];
		subscribeFatalError((fatal) => escalated.push(fatal.message));
		install();

		emitWindowError(stub, "TypeError: boom");

		assert.equal(escalated.length, 1);
	});
});
