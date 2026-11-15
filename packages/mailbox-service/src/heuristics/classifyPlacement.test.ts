/**
 * Issue #300 (RFC 039 Decision 3/3a) added the user's placement instruction as
 * a confident move, plus a `setAt` tie-break against `vip`/`wellknown`
 * (Decision 3a). Issue #605 adds the other direction, `neverSpam`. These tests
 * cover both instruction branches.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { MessageItem } from "@remit/data-ports";
import {
	PlacementAction,
	PlacementConfidence,
	SenderOverride,
	SenderTrust,
} from "@remit/domain-enums";
import {
	classifyPlacement,
	decidePlacement,
	type JunkExit,
	resolveSenderPlacement,
} from "./classifyPlacement.js";

const ARRIVAL: JunkExit = { state: "Arrival" };
const RESCUE: JunkExit = { state: "Rescue", clean: false };
const RESCUE_CLEAN: JunkExit = { state: "Rescue", clean: true };

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
			ARRIVAL,
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
				ARRIVAL,
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
			ARRIVAL,
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
			ARRIVAL,
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
			ARRIVAL,
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

describe("decidePlacement rescuing Junk mail", () => {
	const rescue = (
		message: MessageItem,
		senderTrust: (typeof SenderTrust)[keyof typeof SenderTrust],
		senderOverride: (typeof SenderOverride)[keyof typeof SenderOverride],
		junkExit: JunkExit,
	) =>
		decidePlacement(
			message,
			"junk",
			senderTrust,
			senderOverride,
			false,
			false,
			junkExit,
		);

	for (const [trust, override, reason] of [
		[SenderTrust.Vip, SenderOverride.None, "sender=vip"],
		[SenderTrust.Wellknown, SenderOverride.None, "sender=wellknown"],
		[SenderTrust.Unknown, SenderOverride.NeverSpam, "sender=never-spam"],
	] as const) {
		it(`moves a ${reason} message to the Inbox`, () => {
			assert.deepEqual(rescue(baseMessage(), trust, override, RESCUE), {
				verdict: {
					action: "move-to-inbox",
					confidence: "confident",
					reasons: [reason],
				},
				destination: "inbox",
			});
		});
	}

	it("moves an unknown sender's message with a clean verdict to the Inbox", () => {
		const decision = rescue(
			baseMessage(),
			SenderTrust.Unknown,
			SenderOverride.None,
			RESCUE_CLEAN,
		);
		assert.equal(decision.destination, "inbox");
		assert.deepEqual(decision.verdict.reasons, ["spam=clean"]);
	});

	it("leaves an unknown sender's unscored message in Junk", () => {
		const decision = rescue(
			baseMessage(),
			SenderTrust.Unknown,
			SenderOverride.None,
			RESCUE,
		);
		assert.equal(decision.verdict.action, "leave");
		assert.equal(decision.destination, undefined);
	});

	it("leaves a trusted sender's message in Junk when its From failed DMARC", () => {
		const decision = rescue(
			baseMessage({ authResult: { dmarc: "Fail" } } as Partial<MessageItem>),
			SenderTrust.Vip,
			SenderOverride.NeverSpam,
			RESCUE,
		);
		assert.equal(decision.verdict.action, "leave");
		assert.equal(decision.destination, undefined);
	});

	it("leaves a blocked sender's message in Junk", () => {
		const decision = rescue(
			baseMessage(),
			SenderTrust.Vip,
			SenderOverride.Blocked,
			RESCUE_CLEAN,
		);
		assert.equal(decision.destination, undefined);
	});

	it("leaves a message the user reported in Junk", () => {
		const decision = rescue(
			baseMessage({ spamReport: { reportedAt: 1 } }),
			SenderTrust.Vip,
			SenderOverride.None,
			RESCUE_CLEAN,
		);
		assert.deepEqual(decision.verdict.reasons, ["placed-in-junk"]);
		assert.equal(decision.destination, undefined);
	});

	it("leaves a message the user moved into Junk", () => {
		const decision = rescue(
			baseMessage({ originalMailboxId: "inbox-1" }),
			SenderTrust.Vip,
			SenderOverride.None,
			RESCUE_CLEAN,
		);
		assert.deepEqual(decision.verdict.reasons, ["placed-in-junk"]);
		assert.equal(decision.destination, undefined);
	});

	it("brings back a message Remit filed in Junk once its sender is trusted", () => {
		const decision = rescue(
			baseMessage({
				originalMailboxId: "inbox-1",
				movedByRemit: true,
				placementVerdict: {
					action: PlacementAction.MoveToJunk,
					confidence: PlacementConfidence.Confident,
					fromPlacement: "inbox",
					reasons: ["classifier=spam"],
					dryRun: false,
					decidedAt: 1,
				},
			}),
			SenderTrust.Wellknown,
			SenderOverride.None,
			RESCUE,
		);
		assert.equal(decision.destination, "inbox");
	});
});
