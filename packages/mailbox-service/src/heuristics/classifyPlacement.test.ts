import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { MessageItem } from "@remit/data-ports";
import { SenderOverride, SenderTrust } from "@remit/domain-enums";
import {
	classifyPlacement,
	decidePlacement,
	resolveSenderPlacement,
} from "./classifyPlacement.js";

const baseMessage = (overrides: Partial<MessageItem> = {}): MessageItem =>
	({
		messageId: "m-1",
		mailboxId: "mb-1",
		uid: 1,
		providerSpam: { classified: false },
		authResult: { dmarc: "Pass" },
		...overrides,
	}) as unknown as MessageItem;

describe("classifyPlacement", () => {
	describe("SenderOverride.Blocked (RFC 039 Decision 3)", () => {
		it("demotes an inbox message from a blocked sender", () => {
			const verdict = classifyPlacement(
				"inbox",
				SenderTrust.Unknown,
				SenderOverride.Blocked,
				false,
			);
			assert.deepEqual(verdict, {
				action: "move-to-junk",
				confidence: "confident",
				reasons: ["sender=blocked"],
			});
		});

		it("demotes a message sitting outside junk/inbox (e.g. a custom folder) from a blocked sender", () => {
			const verdict = classifyPlacement(
				"other",
				SenderTrust.Unknown,
				SenderOverride.Blocked,
				false,
			);
			assert.equal(verdict.action, "move-to-junk");
			assert.equal(verdict.confidence, "confident");
		});

		it("does not demote when the sender carries no instruction, all else equal", () => {
			const verdict = classifyPlacement(
				"inbox",
				SenderTrust.Unknown,
				SenderOverride.None,
				false,
			);
			assert.deepEqual(verdict, {
				action: "leave",
				confidence: "unsure",
				reasons: ["no-confident-signal"],
			});
		});
	});

	describe("SenderOverride.NeverSpam (issue #605)", () => {
		it("leaves a never-spam sender's mail filed in a user folder where it is", () => {
			const verdict = classifyPlacement(
				"other",
				SenderTrust.Unknown,
				SenderOverride.NeverSpam,
				false,
			);
			assert.equal(verdict.action, "leave");
		});
	});

	describe("resolveSenderPlacement (Decision 3a tie-break)", () => {
		it("blocked wins when set after vip", () => {
			const result = resolveSenderPlacement(
				{ trust: SenderTrust.Vip, setAt: 1_000 },
				{ blocked: true, setAt: 5_000 },
				false,
			);
			assert.deepEqual(result, {
				senderTrust: SenderTrust.Unknown,
				senderOverride: SenderOverride.Blocked,
			});
		});

		it("vip wins when set after blocked", () => {
			const result = resolveSenderPlacement(
				{ trust: SenderTrust.Vip, setAt: 5_000 },
				{ blocked: true, setAt: 1_000 },
				false,
			);
			assert.deepEqual(result, {
				senderTrust: SenderTrust.Vip,
				senderOverride: SenderOverride.None,
			});
		});

		it("breaks a same-second tie in favor of blocked", () => {
			const result = resolveSenderPlacement(
				{ trust: SenderTrust.Wellknown, setAt: 1_000 },
				{ blocked: true, setAt: 1_400 },
				false,
			);
			assert.deepEqual(result, {
				senderTrust: SenderTrust.Unknown,
				senderOverride: SenderOverride.Blocked,
			});
		});

		it("blocked applies outright when there is no competing trust flag", () => {
			const result = resolveSenderPlacement(
				{ trust: SenderTrust.Unknown },
				{ blocked: true, setAt: 1_000 },
				false,
			);
			assert.deepEqual(result, {
				senderTrust: SenderTrust.Unknown,
				senderOverride: SenderOverride.Blocked,
			});
		});

		it("passes trust through unchanged when the sender carries no instruction", () => {
			const result = resolveSenderPlacement(
				{ trust: SenderTrust.Wellknown, setAt: 1_000 },
				{ blocked: false },
				false,
			);
			assert.deepEqual(result, {
				senderTrust: SenderTrust.Wellknown,
				senderOverride: SenderOverride.None,
			});
		});

		it("reads never-spam as the instruction, leaving trust untouched", () => {
			const result = resolveSenderPlacement(
				{ trust: SenderTrust.Unknown },
				{ blocked: false },
				true,
			);
			assert.deepEqual(result, {
				senderTrust: SenderTrust.Unknown,
				senderOverride: SenderOverride.NeverSpam,
			});
		});

		it("does not promote a never-spam sender's trust to vip or wellknown", () => {
			const result = resolveSenderPlacement(
				{ trust: SenderTrust.Vip, setAt: 1_000 },
				{ blocked: false },
				true,
			);
			assert.equal(result.senderTrust, SenderTrust.Vip);
			assert.equal(result.senderOverride, SenderOverride.NeverSpam);
		});

		it("resolves a row that somehow carries both instructions to blocked", () => {
			const result = resolveSenderPlacement(
				{ trust: SenderTrust.Unknown },
				{ blocked: true, setAt: 1_000 },
				true,
			);
			assert.equal(result.senderOverride, SenderOverride.Blocked);
		});
	});
});

describe("decidePlacement", () => {
	it("keeps a blocked sender's Junk arrival in Junk", () => {
		const decision = decidePlacement(
			baseMessage(),
			"junk",
			SenderTrust.Unknown,
			SenderOverride.Blocked,
			false,
			false,
		);
		assert.equal(decision.verdict.action, "move-to-junk");
		assert.equal(decision.destination, undefined);
	});

	for (const trust of [SenderTrust.Vip, SenderTrust.Wellknown]) {
		it(`moves a ${trust} sender's Junk arrival to the Inbox over a classifier junk answer`, () => {
			const decision = decidePlacement(
				baseMessage(),
				"junk",
				trust,
				SenderOverride.None,
				true,
				false,
			);
			assert.equal(decision.verdict.action, "move-to-inbox");
			assert.equal(decision.destination, "inbox");
		});
	}

	it("files an autoArchive sender's Junk arrival in the Archive", () => {
		const decision = decidePlacement(
			baseMessage(),
			"junk",
			SenderTrust.Unknown,
			SenderOverride.None,
			false,
			true,
		);
		assert.equal(decision.verdict.action, "move-to-inbox");
		assert.equal(decision.destination, "archive");
	});

	it("files an autoArchive sender's Inbox arrival in the Archive", () => {
		const decision = decidePlacement(
			baseMessage(),
			"inbox",
			SenderTrust.Unknown,
			SenderOverride.None,
			false,
			true,
		);
		assert.equal(decision.destination, "archive");
	});

	it("leaves a message Remit already moved where it is, even when blocked", () => {
		const decision = decidePlacement(
			baseMessage({ movedByRemit: true }),
			"inbox",
			SenderTrust.Unknown,
			SenderOverride.Blocked,
			false,
			true,
		);
		assert.deepEqual(decision, {
			verdict: {
				action: "leave",
				confidence: "confident",
				reasons: ["already-moved-by-remit"],
			},
			destination: undefined,
		});
	});
});
