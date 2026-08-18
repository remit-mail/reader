import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ApiError } from "@/lib/api";
import { bannerWayOut } from "./ErrorBannerProvider";

const issueBody = (href: string): string =>
	new URL(href).searchParams.get("body") ?? "";

const issueTitle = (href: string): string =>
	new URL(href).searchParams.get("title") ?? "";

describe("bannerWayOut — no failure banner is a dead end", () => {
	it("offers a prefilled report on a failure the user cannot act on", () => {
		// The spam report that failed on test.remit.email offered nothing but
		// Dismiss: no reason, no fix, no way to report it.
		const action = bannerWayOut({
			title: "Couldn't report this message as spam",
			detail: "This message could not be processed.",
			error: new ApiError("This message could not be processed.", 422),
		});

		assert.equal(action?.label, "Report an issue");
		assert.ok(
			action?.href.startsWith(
				"https://github.com/remit-mail/reader/issues/new?",
			),
		);
		assert.match(
			issueTitle(action.href),
			/Couldn't report this message as spam/,
		);
		assert.match(
			issueBody(action.href),
			/Couldn't report this message as spam/,
		);
	});

	it("carries the stack of the error that caused the banner", () => {
		const error = new Error("Connection reset by peer");
		const action = bannerWayOut({
			title: "Couldn't move this message",
			error,
		});

		assert.ok(action !== undefined);
		assert.match(issueBody(action.href), /Stacktrace/);
	});

	it("keeps an action the call site already chose", () => {
		const action = bannerWayOut({
			title: "Spellcheck stopped",
			action: { label: "Report this", href: "https://example.invalid/report" },
		});

		assert.deepEqual(action, {
			label: "Report this",
			href: "https://example.invalid/report",
		});
	});

	it("offers none on a warning or a statement of fact", () => {
		assert.equal(
			bannerWayOut({ severity: "warning", title: "Draft saved locally" }),
			undefined,
		);
		assert.equal(
			bannerWayOut({ severity: "info", title: "Sync finished" }),
			undefined,
		);
	});
});
