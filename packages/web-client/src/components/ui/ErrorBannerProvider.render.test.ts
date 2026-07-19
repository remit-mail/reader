import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { ApiError } from "@/lib/api";
import { __resetFatalError, getCurrentFatalError } from "@/lib/fatal-error";
import { ErrorBannerProvider, useErrorBanners } from "./ErrorBannerProvider";
import type { PushErrorInput } from "./error-banners";

/**
 * Push one error through the real provider and report where it went. The
 * routing decision happens inside `pushError`, so a single render is enough:
 * either a fatal was recorded, or the error stayed a soft banner.
 */
const push = (input: PushErrorInput): { escalated: boolean } => {
	const Pusher = () => {
		useErrorBanners().pushError(input);
		return null;
	};
	renderToString(
		createElement(ErrorBannerProvider, null, createElement(Pusher)) as never,
	);
	return { escalated: getCurrentFatalError() !== null };
};

afterEach(() => {
	__resetFatalError();
});

describe("pushError — a banner is a soft surface only", () => {
	it("keeps a soft failure with no error attached in a banner", () => {
		assert.equal(push({ title: "Couldn't save draft" }).escalated, false);
	});

	it("keeps a 4xx the call site owns in a banner", () => {
		assert.equal(
			push({
				title: "Couldn't move this message",
				error: new ApiError("Not found", 404),
			}).escalated,
			false,
		);
	});

	it("escalates a 5xx to the fatal page instead of a toast", () => {
		assert.equal(
			push({
				title: "Couldn't move 339 messages",
				error: new ApiError("Internal error", 500),
			}).escalated,
			true,
		);
		assert.equal(getCurrentFatalError()?.message, "Internal error");
	});

	it("escalates an exception thrown by our own code (issue #55)", () => {
		const bug = new TypeError(
			'can\'t access property "map", N.pages is undefined',
		);
		assert.equal(
			push({ title: "Couldn't move 339 messages", error: bug }).escalated,
			true,
		);
		assert.equal(getCurrentFatalError()?.message, bug.message);
		assert.equal(
			getCurrentFatalError()?.recoverable,
			false,
			"a bug is not something the user can retry away",
		);
	});
});
