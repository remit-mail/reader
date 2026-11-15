import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	AuthResultVerdict,
	SenderOverride,
	SenderTrust,
	SpamSenderScreenRule,
} from "@remit/domain-enums";
import { type ScreenInput, screen } from "./screen.js";

const input = (overrides: Partial<ScreenInput> = {}): ScreenInput => ({
	sender: {
		senderTrust: SenderTrust.Unknown,
		senderOverride: SenderOverride.None,
		knownSender: false,
	},
	filterDecision: { labels: [] },
	hasListUnsubscribe: false,
	hasListId: false,
	dmarc: AuthResultVerdict.Pass,
	senderMessagesSeen: 0,
	...overrides,
});

const known = {
	senderTrust: SenderTrust.Unknown,
	senderOverride: SenderOverride.None,
	knownSender: true,
};

describe("spam screening", () => {
	it("lets mail from a sender the owner has written to through", () => {
		assert.deepEqual(screen(input({ sender: known })), {
			rule: SpamSenderScreenRule.KnownSender,
		});
	});

	it("sends a known sender's mail to the judge when DMARC fails", () => {
		assert.equal(
			screen(input({ sender: known, dmarc: AuthResultVerdict.Fail })),
			undefined,
		);
	});

	it("sends a known sender's mail to the judge when the domain has no DMARC", () => {
		assert.equal(
			screen(input({ sender: known, dmarc: AuthResultVerdict.None })),
			undefined,
		);
	});

	it("sends a known sender's mail to the judge when DMARC is missing", () => {
		assert.equal(screen(input({ sender: known, dmarc: undefined })), undefined);
	});

	it("lets a mailing list with List-Id but no List-Unsubscribe through", () => {
		assert.deepEqual(
			screen(input({ hasListId: true, senderMessagesSeen: 3 })),
			{ rule: SpamSenderScreenRule.Newsletter },
		);
	});

	it("sends a first list message to the judge", () => {
		assert.equal(screen(input({ hasListId: true })), undefined);
	});
});
