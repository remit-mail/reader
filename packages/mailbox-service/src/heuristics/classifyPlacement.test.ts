/**
 * `classifyPlacement` had no dedicated unit test — only the DKIM/DMARC paths
 * were exercised indirectly through realistic-mail fixtures elsewhere. Issue
 * #300 (RFC 039 Decision 3/3a) adds `senderBlocked` as a confident demote
 * independent of every DKIM/DMARC/provider signal, plus a `setAt` tie-break
 * against `vip`/`wellknown` (Decision 3a, `resolveBlockedVsTrust`). These tests
 * cover both the new branch and the pre-existing DKIM/DMARC branches, so a
 * regression in either shows up here.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { MessageItem } from "@remit/data-ports";
import { SenderTrust } from "@remit/domain-enums";
import {
	classifyPlacement,
	resolveBlockedVsTrust,
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
	describe("senderBlocked (RFC 039 Decision 3)", () => {
		it("demotes an inbox message from a blocked sender, independent of DKIM/DMARC", () => {
			const message = baseMessage({
				providerSpam: undefined,
				authResult: undefined,
			});
			const verdict = classifyPlacement(
				message,
				"inbox",
				SenderTrust.Unknown,
				true,
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
				true,
			);
			assert.equal(verdict.action, "move-to-junk");
			assert.equal(verdict.confidence, "confident");
		});

		it("does not re-move a blocked sender's message already in junk", () => {
			const verdict = classifyPlacement(
				baseMessage(),
				"junk",
				SenderTrust.Unknown,
				true,
			);
			assert.notEqual(verdict.action, "move-to-junk");
		});

		it("does not demote when the sender is not blocked, all else equal", () => {
			const verdict = classifyPlacement(
				baseMessage({ providerSpam: undefined, authResult: undefined }),
				"inbox",
				SenderTrust.Unknown,
				false,
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
				true,
			);
			assert.deepEqual(verdict, {
				action: "leave",
				confidence: "confident",
				reasons: ["already-moved-by-remit"],
			});
		});
	});

	describe("resolveBlockedVsTrust (Decision 3a tie-break)", () => {
		it("blocked wins when set after vip", () => {
			const result = resolveBlockedVsTrust(
				{ trust: SenderTrust.Vip, setAt: 1_000 },
				{ blocked: true, setAt: 5_000 },
			);
			assert.deepEqual(result, {
				senderTrust: SenderTrust.Unknown,
				senderBlocked: true,
			});
		});

		it("vip wins when set after blocked", () => {
			const result = resolveBlockedVsTrust(
				{ trust: SenderTrust.Vip, setAt: 5_000 },
				{ blocked: true, setAt: 1_000 },
			);
			assert.deepEqual(result, {
				senderTrust: SenderTrust.Vip,
				senderBlocked: false,
			});
		});

		it("breaks a same-second tie in favor of blocked", () => {
			const result = resolveBlockedVsTrust(
				{ trust: SenderTrust.Wellknown, setAt: 1_000 },
				{ blocked: true, setAt: 1_400 },
			);
			assert.deepEqual(result, {
				senderTrust: SenderTrust.Unknown,
				senderBlocked: true,
			});
		});

		it("blocked applies outright when there is no competing trust flag", () => {
			const result = resolveBlockedVsTrust(
				{ trust: SenderTrust.Unknown },
				{ blocked: true, setAt: 1_000 },
			);
			assert.deepEqual(result, {
				senderTrust: SenderTrust.Unknown,
				senderBlocked: true,
			});
		});

		it("passes trust through unchanged when the sender isn't blocked", () => {
			const result = resolveBlockedVsTrust(
				{ trust: SenderTrust.Wellknown, setAt: 1_000 },
				{ blocked: false },
			);
			assert.deepEqual(result, {
				senderTrust: SenderTrust.Wellknown,
				senderBlocked: false,
			});
		});
	});

	describe("existing DKIM/DMARC paths (unaffected by senderBlocked=false)", () => {
		it("rescues a trusted sender's mail from junk on provider-spam + dmarc-pass", () => {
			const verdict = classifyPlacement(
				baseMessage({ providerSpam: { classified: true } }),
				"junk",
				SenderTrust.Vip,
				false,
			);
			assert.equal(verdict.action, "move-to-inbox");
			assert.equal(verdict.confidence, "confident");
		});

		it("does not rescue an untrusted sender's mail from junk", () => {
			const verdict = classifyPlacement(
				baseMessage({ providerSpam: { classified: true } }),
				"junk",
				SenderTrust.Unknown,
				false,
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
				false,
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
				false,
			);
			assert.deepEqual(verdict, {
				action: "leave",
				confidence: "unsure",
				reasons: ["dkim-mismatch", "dmarc=pass", "deferred-to-llm"],
			});
		});
	});
});
