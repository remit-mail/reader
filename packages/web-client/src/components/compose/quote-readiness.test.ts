import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { quoteReadiness, type QuoteReadinessInput } from "./quote-readiness";

const quoting = (over: Partial<QuoteReadinessInput> = {}): QuoteReadinessInput =>
	({
		isQuoting: true,
		documentHoldsQuote: false,
		sourceResolved: true,
		hasRenderablePart: true,
		hasBody: true,
		isError: false,
		...over,
	}) satisfies QuoteReadinessInput;

describe("what the composer knows about the original it quotes (#1030)", () => {
	it("carries nothing for a new message", () => {
		assert.equal(quoteReadiness(quoting({ isQuoting: false })), "absent");
	});

	it("carries nothing for a draft that was saved with the quote in it", () => {
		assert.equal(
			quoteReadiness(quoting({ documentHoldsQuote: true, hasBody: false })),
			"absent",
		);
	});

	it("waits for a source that has not arrived", () => {
		assert.equal(
			quoteReadiness(
				quoting({
					sourceResolved: false,
					hasRenderablePart: false,
					hasBody: false,
				}),
			),
			"pending",
		);
	});

	it("waits for a declared part whose content has not landed", () => {
		assert.equal(quoteReadiness(quoting({ hasBody: false })), "pending");
	});

	/**
	 * The two states the body hook cannot tell apart on its own: its query is
	 * disabled for both, so neither is loading and neither has failed. Read as
	 * one, a source that will never have a body dead-locks Send or leaves
	 * silently.
	 */
	it("separates a source still arriving from one holding nothing to quote", () => {
		const arriving = quoteReadiness(
			quoting({
				sourceResolved: false,
				hasRenderablePart: false,
				hasBody: false,
			}),
		);
		const attachmentOnly = quoteReadiness(
			quoting({ hasRenderablePart: false, hasBody: false }),
		);

		assert.equal(arriving, "pending");
		assert.equal(attachmentOnly, "unquotable");
		assert.notEqual(arriving, attachmentOnly);
	});

	it("reports a failed fetch rather than waiting on it forever", () => {
		assert.equal(
			quoteReadiness(quoting({ isError: true, hasBody: false })),
			"failed",
		);
	});

	it("is ready once the quoted body is in hand", () => {
		assert.equal(quoteReadiness(quoting()), "ready");
	});
});
