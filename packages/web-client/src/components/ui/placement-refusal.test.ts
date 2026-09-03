import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ApiError } from "@/lib/api";
import {
	isPlacementRefusal,
	placementRefusalBanner,
} from "./placement-refusal.js";

/**
 * The shape a call site receives: the interceptor wraps every failure, so the
 * wire body sits at `.body` and never at the top level (#1004). Building it any
 * other way tests a shape the app cannot produce.
 */
const refusal = (reason: string) =>
	new ApiError("Refused", 409, {
		message: "Message 4f1 was not acted on: its uid does not address it...",
		code: "message_placement_unsettled",
		details: { accountId: "acc-1", messageId: "msg-1", reason },
	});

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
			isPlacementRefusal(new ApiError("Refused", 409, { code: "other" })),
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
		);
		assert.equal(banner.severity, "warning");
		assert.match(banner.detail ?? "", /try again in a moment/i);
	});

	it("promises no remedy for an abandoned move, because there is none", () => {
		// Nothing writes `status: "active"` outside a confirmed move, so a
		// retry or a resync returns the same refusal forever (#1005). Copy that
		// asks for either would send the user round a loop and blame them for
		// it.
		const banner = placementRefusalBanner(
			{ reason: "unverified", messageId: "msg-1" },
			1,
		);
		assert.equal(banner.severity, "error");
		assert.doesNotMatch(banner.detail ?? "", /try again|sync|retry|refresh/i);
		assert.equal(
			banner.action?.href,
			"https://github.com/remit-mail/reader/issues/1005",
		);
	});

	it("counts the selection in the title", () => {
		assert.match(
			placementRefusalBanner({ reason: "in_flight", messageId: "m" }, 4).title,
			/4 messages/,
		);
	});

	it("never repeats the server's uuid at the user", () => {
		for (const reason of ["in_flight", "unverified"] as const) {
			const banner = placementRefusalBanner({ reason, messageId: "msg-1" }, 1);
			assert.doesNotMatch(`${banner.title} ${banner.detail}`, /msg-1/);
		}
	});
});
