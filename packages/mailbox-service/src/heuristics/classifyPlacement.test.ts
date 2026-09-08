/**
 * `classifyPlacement` had no dedicated unit test — only the DKIM/DMARC paths
 * were exercised indirectly through realistic-mail fixtures elsewhere. Issue
 * #300 (RFC 039 Decision 3/3a) added the user's placement instruction as a
 * confident move independent of every DKIM/DMARC/provider signal, plus a
 * `setAt` tie-break against `vip`/`wellknown` (Decision 3a). Issue #605 adds
 * the other direction, `neverSpam`. These tests cover both instruction
 * branches and the pre-existing DKIM/DMARC branches, so a regression in any of
 * them shows up here.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { MessageItem } from "@remit/data-ports";
import { SenderOverride, SenderTrust } from "@remit/domain-enums";
import {
	classifyPlacement,
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
		it("demotes an inbox message from a blocked sender, independent of DKIM/DMARC", () => {
			const message = baseMessage({
				providerSpam: undefined,
				authResult: undefined,
			});
			const verdict = classifyPlacement(
				message,
				"inbox",
				SenderTrust.Unknown,
				SenderOverride.Blocked,
			);
			assert.deepEqual(verdict, {
				action: "move-to-junk",
				confidence: "confident",
				reasons: ["sender=blocked"],
			});
		});

		it("demotes a message sitting outside junk/inbox (e.g. a custom folder) from a blocked sender", () => {
			const verdict = classifyPlacement(
				baseMessage(),
				"other",
				SenderTrust.Unknown,
				SenderOverride.Blocked,
			);
			assert.equal(verdict.action, "move-to-junk");
			assert.equal(verdict.confidence, "confident");
		});

		it("does not re-move a blocked sender's message already in junk", () => {
			const verdict = classifyPlacement(
				baseMessage(),
				"junk",
				SenderTrust.Unknown,
				SenderOverride.Blocked,
			);
			assert.notEqual(verdict.action, "move-to-junk");
		});

		it("does not demote when the sender carries no instruction, all else equal", () => {
			const verdict = classifyPlacement(
				baseMessage({ providerSpam: undefined, authResult: undefined }),
				"inbox",
				SenderTrust.Unknown,
				SenderOverride.None,
			);
			assert.deepEqual(verdict, {
				action: "leave",
				confidence: "unsure",
				reasons: ["missing-signals"],
			});
		});

		it("still leaves an already-Remit-moved message alone even when blocked", () => {
			const verdict = classifyPlacement(
				baseMessage({ movedByRemit: true }),
				"inbox",
				SenderTrust.Unknown,
				SenderOverride.Blocked,
			);
			assert.deepEqual(verdict, {
				action: "leave",
				confidence: "confident",
				reasons: ["already-moved-by-remit"],
			});
		});
	});

	describe("SenderOverride.NeverSpam (issue #605)", () => {
		it("rescues mail the provider rated clean from a domain that publishes no DMARC", () => {
			const verdict = classifyPlacement(
				baseMessage({
					providerSpam: { classified: false },
					authResult: { dmarc: "None" },
				}),
				"junk",
				SenderTrust.Unknown,
				SenderOverride.NeverSpam,
			);
			assert.deepEqual(verdict, {
				action: "move-to-inbox",
				confidence: "confident",
				reasons: ["sender=never-spam"],
			});
		});

		it("rescues before the missing-signals return, so a message with no parsed signals still comes out of junk", () => {
			const verdict = classifyPlacement(
				baseMessage({ providerSpam: undefined, authResult: undefined }),
				"junk",
				SenderTrust.Unknown,
				SenderOverride.NeverSpam,
			);
			assert.equal(verdict.action, "move-to-inbox");
			assert.equal(verdict.confidence, "confident");
		});

		it("leaves a never-spam sender's mail filed in a user folder where it is", () => {
			const verdict = classifyPlacement(
				baseMessage(),
				"other",
				SenderTrust.Unknown,
				SenderOverride.NeverSpam,
			);
			assert.equal(verdict.action, "leave");
		});

		it("still demotes a never-spam sender's inbox mail on dkim-mismatch + dmarc-fail", () => {
			const verdict = classifyPlacement(
				baseMessage({
					authResult: { dmarc: "Fail" },
					authenticity: { fromDomain: "example.com", dkimMismatch: true },
				}),
				"inbox",
				SenderTrust.Unknown,
				SenderOverride.NeverSpam,
			);
			assert.deepEqual(verdict, {
				action: "move-to-junk",
				confidence: "confident",
				reasons: ["dkim-mismatch", "dmarc=fail", "sender=untrusted"],
			});
		});

		it("still leaves an already-Remit-moved message alone", () => {
			const verdict = classifyPlacement(
				baseMessage({ movedByRemit: true }),
				"junk",
				SenderTrust.Unknown,
				SenderOverride.NeverSpam,
			);
			assert.deepEqual(verdict, {
				action: "leave",
				confidence: "confident",
				reasons: ["already-moved-by-remit"],
			});
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

	describe("existing DKIM/DMARC paths (unaffected by SenderOverride.None)", () => {
		it("rescues a trusted sender's mail from junk on provider-spam + dmarc-pass", () => {
			const verdict = classifyPlacement(
				baseMessage({ providerSpam: { classified: true } }),
				"junk",
				SenderTrust.Vip,
				SenderOverride.None,
			);
			assert.equal(verdict.action, "move-to-inbox");
			assert.equal(verdict.confidence, "confident");
		});

		it("does not rescue an untrusted sender's mail from junk", () => {
			const verdict = classifyPlacement(
				baseMessage({ providerSpam: { classified: true } }),
				"junk",
				SenderTrust.Unknown,
				SenderOverride.None,
			);
			assert.equal(verdict.action, "leave");
			assert.equal(verdict.confidence, "unsure");
		});

		it("demotes an untrusted sender's inbox mail on dkim-mismatch + dmarc-fail", () => {
			const verdict = classifyPlacement(
				baseMessage({
					authResult: { dmarc: "Fail" },
					authenticity: { fromDomain: "example.com", dkimMismatch: true },
				}),
				"inbox",
				SenderTrust.Unknown,
				SenderOverride.None,
			);
			assert.deepEqual(verdict, {
				action: "move-to-junk",
				confidence: "confident",
				reasons: ["dkim-mismatch", "dmarc=fail", "sender=untrusted"],
			});
		});

		it("defers a dkim-mismatch + dmarc-pass message to a later LLM tier", () => {
			const verdict = classifyPlacement(
				baseMessage({
					authResult: { dmarc: "Pass" },
					authenticity: { fromDomain: "example.com", dkimMismatch: true },
				}),
				"inbox",
				SenderTrust.Unknown,
				SenderOverride.None,
			);
			assert.deepEqual(verdict, {
				action: "leave",
				confidence: "unsure",
				reasons: ["dkim-mismatch", "dmarc=pass", "deferred-to-llm"],
			});
		});
	});
});
