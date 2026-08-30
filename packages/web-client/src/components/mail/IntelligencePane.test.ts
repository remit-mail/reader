import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { resolveSimilarState, resolveSpamAction } from "./IntelligencePane";

describe("resolveSpamAction (#648)", () => {
	test("offers Report spam when the message carries no spam report", () => {
		assert.equal(resolveSpamAction({}), "reportSpam");
	});

	test("offers Report spam regardless of which mailbox the message is in", () => {
		// A report is never derived from placement — reporting a message the
		// provider's own filter already put in Junk is a real, no-op-move case.
		assert.equal(resolveSpamAction({ spamReport: undefined }), "reportSpam");
	});

	test("offers Not spam once the message carries a spam report", () => {
		assert.equal(
			resolveSpamAction({ spamReport: { reportedAt: Date.now() } }),
			"notSpam",
		);
	});

	test("the two actions are mutually exclusive", () => {
		const reportable = resolveSpamAction({});
		const reported = resolveSpamAction({
			spamReport: { reportedAt: Date.now() },
		});
		assert.notEqual(reportable, reported);
	});
});

describe("resolveSimilarState — fail-fast on similar-messages search", () => {
	test("a fatal 5xx does NOT show the grey label — it escalates instead (ready)", () => {
		assert.equal(
			resolveSimilarState({
				similarError: new Error("500"),
				similarErrorIsFatal: true,
				isSimilarLoading: false,
				semanticEnabled: true,
			}),
			"ready",
		);
	});

	test("a soft (non-fatal) error keeps the muted error state", () => {
		assert.equal(
			resolveSimilarState({
				similarError: new Error("404"),
				similarErrorIsFatal: false,
				isSimilarLoading: false,
				semanticEnabled: true,
			}),
			"error",
		);
	});

	test("an empty result (no error) is a soft ready state", () => {
		assert.equal(
			resolveSimilarState({
				similarError: null,
				similarErrorIsFatal: false,
				isSimilarLoading: false,
				semanticEnabled: true,
			}),
			"ready",
		);
	});

	test("loading wins when there is no error", () => {
		assert.equal(
			resolveSimilarState({
				similarError: null,
				similarErrorIsFatal: false,
				isSimilarLoading: true,
				semanticEnabled: true,
			}),
			"loading",
		);
	});
});

// Off is a property of the deployment, and it leads: nothing was embedded, so
// there was no query, and the section states the setting instead of an empty
// list (#1068). `undefined` is the config read still in flight, which is not
// an answer.
describe("resolveSimilarState — semantic search off on this instance", () => {
	test("off wins over every runtime state", () => {
		assert.equal(
			resolveSimilarState({
				similarError: new Error("404"),
				similarErrorIsFatal: false,
				isSimilarLoading: true,
				semanticEnabled: false,
			}),
			"off",
		);
	});

	test("a config read still in flight is not an off state", () => {
		assert.equal(
			resolveSimilarState({
				similarError: null,
				similarErrorIsFatal: false,
				isSimilarLoading: false,
				semanticEnabled: undefined,
			}),
			"ready",
		);
	});
});
