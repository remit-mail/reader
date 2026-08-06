/**
 * Mounts the real hook against the real fetch seam to prove the pending state
 * a press needs actually toggles (issue #648 review): with no optimistic
 * cache patch, a press that never flips `isReporting`/`isRestoring` would be
 * a genuinely dead control — nothing visible changes until the request lands.
 */

import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { createElement } from "react";
import { createDomHarness, type DomHarness } from "../test-support/dom";
import { type HttpMock, mockFetch } from "../test-support/http";
import { useReportSpam } from "./useReportSpam";

let harness: DomHarness | undefined;
let http: HttpMock;

const mountHook = <T>(useHook: () => T): (() => T) => {
	let value: T | undefined;
	const Probe = () => {
		value = useHook();
		return null;
	};
	harness = createDomHarness();
	harness.renderApp(createElement(Probe));
	return () => {
		if (value === undefined) throw new Error("hook did not render");
		return value;
	};
};

afterEach(() => {
	harness?.close();
	harness = undefined;
	http.restore();
});

/**
 * Polls `predicate` until it's true, yielding real event-loop turns between
 * attempts rather than spinning a fixed count of microtask flushes — the
 * chain from a resolved fetch to a re-render crosses enough async boundaries
 * (response parsing, `throwOnBulkFailure`, `onSuccess`'s invalidation, React's
 * commit) that a fixed count reads as flaky under load instead of wrong.
 */
const waitFor = async (
	predicate: () => boolean,
	timeoutMs = 2000,
): Promise<void> => {
	if (!harness) throw new Error("nothing mounted");
	const deadline = Date.now() + timeoutMs;
	while (!predicate()) {
		if (Date.now() > deadline) {
			throw new Error(
				`waitFor: condition never became true within ${timeoutMs}ms`,
			);
		}
		await harness.flush();
		await harness.wait(5);
	}
};

describe("useReportSpam pending state (#648 review)", () => {
	it("isReporting goes true for the duration of an in-flight report, then false", async () => {
		let resolveRequest: (() => void) | undefined;
		http = mockFetch(
			() =>
				new Promise((resolve) => {
					resolveRequest = () => resolve({ successCount: 1, failureCount: 0 });
				}),
		);
		const hook = mountHook(() => useReportSpam({ mailboxId: "mbx-inbox" }));

		assert.equal(hook().isReporting, false);

		hook().reportSpam(["msg-1"]);
		await waitFor(() => hook().isReporting === true);

		assert.ok(resolveRequest, "the request never reached the mock");
		resolveRequest?.();
		await waitFor(() => hook().isReporting === false);
	});

	it("isRestoring goes true for the duration of an in-flight undo, then false", async () => {
		let resolveRequest: (() => void) | undefined;
		http = mockFetch(
			() =>
				new Promise((resolve) => {
					resolveRequest = () => resolve({ successCount: 1, failureCount: 0 });
				}),
		);
		const hook = mountHook(() => useReportSpam({ mailboxId: "mbx-junk" }));

		assert.equal(hook().isRestoring, false);

		hook().notSpam(["msg-1"]);
		await waitFor(() => hook().isRestoring === true);

		resolveRequest?.();
		await waitFor(() => hook().isRestoring === false);
	});

	it("sends the request to the report-spam endpoint with the pressed message id", async () => {
		http = mockFetch(() => ({ successCount: 1, failureCount: 0 }));
		const hook = mountHook(() => useReportSpam({ mailboxId: "mbx-inbox" }));

		hook().reportSpam(["msg-1"]);
		await waitFor(() => http.to("/messages/report-spam").length > 0);

		const calls = http.to("/messages/report-spam");
		assert.equal(calls.length, 1);
		assert.deepEqual(calls[0].body, { messageIds: ["msg-1"] });
	});
});
