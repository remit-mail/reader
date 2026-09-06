import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { wrapHttpFailure } from "@/lib/api";
import {
	isPlacementRefusal,
	placementRefusalBanner,
} from "./placement-refusal.js";

// The reader is handed what the error interceptor produces, not the flat wire
// body it carries at `.body` (#1004).
const refusal = (reason: string) =>
	wrapHttpFailure(
		{
			message:
				"Message 4f1 was not acted on: its folder and uid do not name...",
			code: "message_placement_unsettled",
			details: { accountId: "acc-1", messageId: "msg-1", reason },
		},
		409,
	);

describe("isPlacementRefusal", () => {
	it("reads the reason and the message off the coded body", () => {
		assert.deepEqual(isPlacementRefusal(refusal("in_flight")), {
			reason: "in_flight",
			messageId: "msg-1",
		});
	});

	it("ignores every other failure", () => {
		assert.equal(isPlacementRefusal(undefined), undefined);
		assert.equal(isPlacementRefusal(new Error("network")), undefined);
		assert.equal(
			isPlacementRefusal(wrapHttpFailure({ code: "other" }, 409)),
			undefined,
		);
		assert.equal(isPlacementRefusal(refusal("something_else")), undefined);
	});

	it("does not match on the message text alone", () => {
		assert.equal(
			isPlacementRefusal(new Error("an earlier move has not settled")),
			undefined,
		);
	});
});

describe("placementRefusalBanner", () => {
	it("tells an in-flight move to wait", () => {
		const banner = placementRefusalBanner(
			{ reason: "in_flight", messageId: "msg-1" },
			1,
			"delete",
		);
		assert.equal(banner.severity, "warning");
		assert.match(banner.detail ?? "", /try again in a moment/i);
	});

	it("tells an abandoned move to resync, not to wait", () => {
		const banner = placementRefusalBanner(
			{ reason: "unverified", messageId: "msg-1" },
			1,
			"delete",
		);
		assert.match(banner.detail ?? "", /sync the folder/i);
		assert.doesNotMatch(banner.detail ?? "", /try again in a moment/i);
	});

	it("counts the selection in the title", () => {
		assert.match(
			placementRefusalBanner(
				{ reason: "in_flight", messageId: "m" },
				4,
				"delete",
			).title,
			/4 messages/,
		);
	});

	// A move refused mid-flight told the user their delete failed — an action
	// they never took, and a remedy pointing at the wrong verb.
	it("names the action the user pressed, not the delete", () => {
		const title = placementRefusalBanner(
			{ reason: "in_flight", messageId: "msg-1" },
			1,
			"move",
		).title;
		assert.match(title, /move this message/i);
		assert.doesNotMatch(title, /delete/i);

		const detail =
			placementRefusalBanner(
				{ reason: "unverified", messageId: "msg-1" },
				1,
				"move",
			).detail ?? "";
		assert.match(detail, /move it again/i);
		assert.doesNotMatch(detail, /delete/i);
	});

	it("never repeats the server's uuid at the user", () => {
		for (const reason of ["in_flight", "unverified"] as const) {
			const banner = placementRefusalBanner(
				{ reason, messageId: "msg-1" },
				1,
				"delete",
			);
			assert.doesNotMatch(`${banner.title} ${banner.detail}`, /msg-1/);
		}
	});
});
