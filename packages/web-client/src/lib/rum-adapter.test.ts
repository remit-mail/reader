import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import { AwsRum } from "aws-rum-web";
import { createRumTelemetry, initRum } from "./rum-adapter";

interface RumStub {
	appMonitorId: string;
	calls: {
		recordPageView: string[];
		recordError: Error[];
		recordEvent: { name: string; attributes: Record<string, unknown> }[];
	};
}

function resetInstances(): void {
	(
		globalThis as unknown as { __AWS_RUM_MOCKS__: { instances: unknown[] } }
	).__AWS_RUM_MOCKS__ = { instances: [] };
}

function getLastInstance(): RumStub {
	const mocks = (
		globalThis as unknown as {
			__AWS_RUM_MOCKS__: { instances: RumStub[] };
		}
	).__AWS_RUM_MOCKS__;
	const instance = mocks.instances.at(-1);
	assert.ok(instance, "Expected an AwsRum instance to have been created");
	return instance;
}

function makeRum(): AwsRum {
	return new (
		AwsRum as unknown as new (
			id: string,
			v: string,
			r: string,
			c: Record<string, unknown>,
		) => AwsRum
	)("monitor-id", "1.0.0", "eu-west-1", {});
}

function stubCalls(rum: AwsRum): RumStub["calls"] {
	return (rum as unknown as RumStub).calls;
}

describe("createRumTelemetry", () => {
	let rum: AwsRum;

	beforeEach(() => {
		resetInstances();
		rum = makeRum();
	});

	it("recordPageView strips the entire query string", () => {
		const t = createRumTelemetry(rum);
		t.recordPageView("/callback?token=secret&next=/inbox");
		assert.equal(stubCalls(rum).recordPageView[0], "/callback");
	});

	it("recordPageView strips fragment-only paths", () => {
		const t = createRumTelemetry(rum);
		t.recordPageView("/inbox#fragment");
		assert.equal(stubCalls(rum).recordPageView[0], "/inbox");
	});

	it("recordPageView strips message id path segments", () => {
		const t = createRumTelemetry(rum);
		t.recordPageView("/messages/msg_abc123def456");
		assert.ok(
			!stubCalls(rum).recordPageView[0]?.includes("msg_abc123def456"),
			"message id must be redacted",
		);
	});

	it("recordError scrubs message id tokens from error messages", () => {
		const t = createRumTelemetry(rum);
		const error = new Error("failed to load /messages/msg_abc123def456");
		t.recordError(error);
		const recorded = stubCalls(rum).recordError[0] as Error;
		assert.ok(
			!recorded.message.includes("msg_abc123def456"),
			"message id must be scrubbed from error message",
		);
	});

	it("recordError preserves error name on scrubbed errors", () => {
		const t = createRumTelemetry(rum);
		const error = new TypeError("token=secret leaked into /messages/msg_xyz");
		t.recordError(error);
		const recorded = stubCalls(rum).recordError[0] as Error;
		assert.equal(recorded.name, "TypeError");
	});
});

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

function getRumConfig(
	instance: RumStub,
): { telemetries: string[] } & Record<string, unknown> {
	return (instance as unknown as { config: { telemetries: string[] } }).config;
}

describe("initRum", () => {
	afterEach(() => {
		delete globalThis.__REMIT_CONFIG__;
		delete (globalThis as unknown as { window?: unknown }).window;
	});

	it("does not enable leaky auto-telemetries", () => {
		resetInstances();
		installWindowStub();
		globalThis.__REMIT_CONFIG__ = {
			rum: { appMonitorId: "test-monitor-id" },
		};
		initRum();
		const config = getRumConfig(getLastInstance());
		assert.ok(
			!config.telemetries.includes("errors"),
			"errors auto-capture must be disabled",
		);
		assert.ok(
			!config.telemetries.includes("http"),
			"http auto-capture must be disabled",
		);
	});

	it("disables auto page view so paths are recorded via the sanitizing adapter", () => {
		resetInstances();
		installWindowStub();
		globalThis.__REMIT_CONFIG__ = {
			rum: { appMonitorId: "test-monitor-id" },
		};
		initRum();
		const config = getRumConfig(getLastInstance());
		assert.equal(config.disableAutoPageView, true);
	});

	it("scrubs uncaught errors before recording them through RUM", () => {
		resetInstances();
		const win = installWindowStub();
		globalThis.__REMIT_CONFIG__ = {
			rum: { appMonitorId: "test-monitor-id" },
		};
		initRum();
		const handler = win.listeners.get("error");
		assert.ok(handler, "Expected a global error handler");
		handler({
			error: new Error("failed to load /messages/msg_abc123def456"),
			message: "failed to load /messages/msg_abc123def456",
		});
		const recorded = stubCalls(getLastInstance() as unknown as AwsRum)
			.recordError[0] as Error;
		assert.ok(
			!recorded.message.includes("msg_abc123def456"),
			"uncaught error message must be scrubbed",
		);
	});

	it("scrubs unhandled rejections before recording them through RUM", () => {
		resetInstances();
		const win = installWindowStub();
		globalThis.__REMIT_CONFIG__ = {
			rum: { appMonitorId: "test-monitor-id" },
		};
		initRum();
		const handler = win.listeners.get("unhandledrejection");
		assert.ok(handler, "Expected a global unhandledrejection handler");
		handler({
			reason: new Error("rejected loading /messages/msg_xyz789"),
		});
		const recorded = stubCalls(getLastInstance() as unknown as AwsRum)
			.recordError[0] as Error;
		assert.ok(
			!recorded.message.includes("msg_xyz789"),
			"rejection reason must be scrubbed",
		);
	});
});
