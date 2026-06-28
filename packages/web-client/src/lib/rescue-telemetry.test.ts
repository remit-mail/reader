import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Telemetry } from "@/lib/telemetry";
import {
	recordRescueCandidatesSurfaced,
	recordRescueCommitted,
	recordRescueFlowOpened,
	recordRescueSentToJunk,
} from "./rescue-telemetry";

interface RecordedEvent {
	name: string;
	attributes?: Record<string, string>;
}

function stubTelemetry(): { telemetry: Telemetry; events: RecordedEvent[] } {
	const events: RecordedEvent[] = [];
	const telemetry: Telemetry = {
		recordPageView: () => undefined,
		recordError: () => undefined,
		recordTiming: () => undefined,
		recordEvent: (name, attributes) => events.push({ name, attributes }),
	};
	return { telemetry, events };
}

describe("rescue telemetry", () => {
	it("emits candidates surfaced with the count", () => {
		const { telemetry, events } = stubTelemetry();
		recordRescueCandidatesSurfaced(telemetry, 7);
		assert.deepEqual(events, [
			{ name: "rescue.candidates_surfaced", attributes: { count: "7" } },
		]);
	});

	it("emits flow opened with the count", () => {
		const { telemetry, events } = stubTelemetry();
		recordRescueFlowOpened(telemetry, 3);
		assert.deepEqual(events, [
			{ name: "rescue.flow_opened", attributes: { count: "3" } },
		]);
	});

	it("emits committed with selected vs total and an inbox destination", () => {
		const { telemetry, events } = stubTelemetry();
		recordRescueCommitted(telemetry, { selected: 2, total: 5, toInbox: true });
		assert.deepEqual(events, [
			{
				name: "rescue.committed",
				attributes: { selected: "2", total: "5", destination: "inbox" },
			},
		]);
	});

	it("marks a non-inbox destination as other", () => {
		const { telemetry, events } = stubTelemetry();
		recordRescueCommitted(telemetry, { selected: 1, total: 1, toInbox: false });
		assert.equal(events[0]?.attributes?.destination, "other");
	});

	it("emits the reverse signal with trust and rescuable flag", () => {
		const { telemetry, events } = stubTelemetry();
		recordRescueSentToJunk(telemetry, {
			count: 1,
			senderTrust: "vip",
			wasRescuable: true,
		});
		assert.deepEqual(events, [
			{
				name: "rescue.sent_to_junk",
				attributes: { count: "1", senderTrust: "vip", wasRescuable: "true" },
			},
		]);
	});
});
