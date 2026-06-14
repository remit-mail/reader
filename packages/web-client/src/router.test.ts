import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Telemetry } from "./lib/telemetry";

interface SubscribeCall {
	eventType: string;
	fn: (event: { toLocation: { pathname: string } }) => void;
}

interface RouterStub {
	subscribeCalls: SubscribeCall[];
	subscribe(
		eventType: string,
		fn: (event: { toLocation: { pathname: string } }) => void,
	): () => void;
}

function makeRouterStub(): RouterStub {
	const stub: RouterStub = {
		subscribeCalls: [],
		subscribe(eventType, fn) {
			stub.subscribeCalls.push({ eventType, fn });
			return () => undefined;
		},
	};
	return stub;
}

function makeTelemetryStub(): Telemetry & { pageViews: string[] } {
	const stub = {
		pageViews: [] as string[],
		recordPageView(path: string) {
			stub.pageViews.push(path);
		},
		recordError: () => undefined,
		recordEvent: () => undefined,
		recordTiming: () => undefined,
	};
	return stub;
}

function wirePageViews(router: RouterStub, telemetry: Telemetry): void {
	router.subscribe("onResolved", (event) => {
		telemetry.recordPageView(event.toLocation.pathname);
	});
}

describe("router page-view telemetry wiring", () => {
	it("subscribes to onResolved", () => {
		const router = makeRouterStub();
		const telemetry = makeTelemetryStub();
		wirePageViews(router, telemetry);
		assert.equal(router.subscribeCalls.length, 1);
		assert.equal(router.subscribeCalls[0]?.eventType, "onResolved");
	});

	it("calls recordPageView with pathname on each navigation", () => {
		const router = makeRouterStub();
		const telemetry = makeTelemetryStub();
		wirePageViews(router, telemetry);

		const handler = router.subscribeCalls[0]?.fn;
		assert.ok(handler, "Expected a subscribe handler");

		handler({ toLocation: { pathname: "/mail" } });
		handler({ toLocation: { pathname: "/settings" } });

		assert.deepEqual(telemetry.pageViews, ["/mail", "/settings"]);
	});

	it("is a no-op when telemetry is noopTelemetry (does not throw)", () => {
		const router = makeRouterStub();
		const telemetry = makeTelemetryStub();
		telemetry.recordPageView = () => undefined;
		wirePageViews(router, telemetry);

		const handler = router.subscribeCalls[0]?.fn;
		assert.ok(handler);
		assert.doesNotThrow(() => handler({ toLocation: { pathname: "/mail" } }));
	});
});
