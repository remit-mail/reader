/**
 * The spam quick action stayed clickable throughout its own request (issue
 * #648 review): the server dedupes message ids only within a single call, so
 * two clicks fired two separate HTTP requests. For the undo direction this
 * produced a wrong message — concurrent `notSpam` #2 reads
 * `originalMailboxId` before #1 clears it, waits on #1's restore move, and
 * can throw `MoveNotSettledError` on an undo that already succeeded. Wires
 * the real `useReportSpam` hook to the real `IntelligencePanel` (the shape
 * `IntelligencePane.tsx`'s `WiredPanel` uses) and clicks the real button
 * twice to prove the fix: disabled while pending blocks the second request
 * at the DOM level, not just in the hook.
 */

import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import type { IntelligenceData } from "@remit/ui";
import { IntelligencePanel } from "@remit/ui";
import { createElement } from "react";
import { useReportSpam } from "@/hooks/useReportSpam";
import { createDomHarness, type DomHarness } from "@/test-support/dom";
import { type HttpMock, mockFetch } from "@/test-support/http";

const baseData: IntelligenceData = {
	sender: {
		name: "Alex Rivera",
		email: "alex@example.com",
		trust: "wellknown",
		firstSeenLabel: "Jan 2025",
	},
	authenticity: {
		verdict: "aligned",
		fromDomain: "example.com",
		dkimDomain: "example.com",
		summary: "This message was signed by example.com.",
	},
	category: { value: "Personal" },
	similar: [],
};

const ReportHarness = () => {
	const { reportSpam, isReporting } = useReportSpam({ mailboxId: "mbx-inbox" });
	return createElement(IntelligencePanel, {
		data: baseData,
		actions: { onReportSpam: () => reportSpam(["msg-1"]) },
		reportSpamPending: isReporting,
	});
};

const UndoHarness = () => {
	const { notSpam, isRestoring } = useReportSpam({ mailboxId: "mbx-junk" });
	return createElement(IntelligencePanel, {
		data: baseData,
		actions: { onNotSpam: () => notSpam(["msg-1"]) },
		notSpamPending: isRestoring,
	});
};

let harness: DomHarness | undefined;
let http: HttpMock;

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

afterEach(() => {
	harness?.close();
	harness = undefined;
	http.restore();
});

describe("the spam quick action disables itself for the duration of its own request (#648 review)", () => {
	it("report direction: a second click while the report is in flight sends only one request", async () => {
		let resolveRequest: (() => void) | undefined;
		http = mockFetch(
			() =>
				new Promise((resolve) => {
					resolveRequest = () => resolve({ successCount: 1, failureCount: 0 });
				}),
		);
		harness = createDomHarness();
		harness.renderApp(createElement(ReportHarness));

		const button = harness.byText("button", "Report spam") as HTMLButtonElement;
		harness.click(button);
		await waitFor(() => button.textContent === "Reporting…");

		assert.equal(button.disabled, true, "a control mid-request must disable");
		harness.click(button);

		assert.ok(resolveRequest, "the request never reached the mock");
		resolveRequest?.();
		await waitFor(() => button.textContent === "Report spam");

		assert.equal(http.to("/messages/report-spam").length, 1);
	});

	it("undo direction: a second click while the undo is in flight sends only one request", async () => {
		let resolveRequest: (() => void) | undefined;
		http = mockFetch(
			() =>
				new Promise((resolve) => {
					resolveRequest = () => resolve({ successCount: 1, failureCount: 0 });
				}),
		);
		harness = createDomHarness();
		harness.renderApp(createElement(UndoHarness));

		const button = harness.byText("button", "Not spam") as HTMLButtonElement;
		harness.click(button);
		await waitFor(() => button.textContent === "Undoing…");

		assert.equal(button.disabled, true, "a control mid-request must disable");
		harness.click(button);

		assert.ok(resolveRequest, "the request never reached the mock");
		resolveRequest?.();
		await waitFor(() => button.textContent === "Not spam");

		assert.equal(http.to("/messages/not-spam").length, 1);
	});
});
