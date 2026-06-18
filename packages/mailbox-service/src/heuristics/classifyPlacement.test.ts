import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { MessageItem } from "@remit/remit-electrodb-service";
import { SenderTrust } from "@remit/domain-enums";
import { classifyPlacement } from "./classifyPlacement.js";

const baseMessage = (): Partial<MessageItem> => ({
	messageId: "msg-1",
	mailboxId: "mailbox-1",
	uid: 1,
	sequenceNumber: 1,
	rfc822Size: 100,
	internalDate: Date.now(),
	envelopeId: "env-1",
	rootBodyPartId: "body-1",
	createdAt: Date.now(),
	updatedAt: Date.now(),
});

const message = (overrides: Partial<MessageItem> = {}): MessageItem =>
	({
		...baseMessage(),
		...overrides,
	}) as MessageItem;

describe("classifyPlacement", () => {
	// Rescue (junk → inbox), #563–566 cluster.
	it("rescues legit-in-junk from a trusted (VIP) sender — provider spam + dmarc=pass", () => {
		const msg = message({
			providerSpam: { classified: true },
			authResult: { dmarc: "Pass" },
		});
		const verdict = classifyPlacement(msg, "junk", SenderTrust.Vip);
		assert.equal(verdict.action, "move-to-inbox");
		assert.equal(verdict.confidence, "confident");
	});

	it("rescues legit-in-junk from a Wellknown sender", () => {
		const msg = message({
			providerSpam: { classified: true },
			authResult: { dmarc: "Pass" },
		});
		const verdict = classifyPlacement(msg, "junk", SenderTrust.Wellknown);
		assert.equal(verdict.action, "move-to-inbox");
		assert.equal(verdict.confidence, "confident");
	});

	it("leaves legit-looking junk from an unknown sender (anti-spoof guard)", () => {
		const msg = message({
			providerSpam: { classified: true },
			authResult: { dmarc: "Pass" },
		});
		const verdict = classifyPlacement(msg, "junk", SenderTrust.Unknown);
		assert.equal(verdict.action, "leave");
		assert.equal(verdict.confidence, "unsure");
	});

	it("does not rescue when provider classified ham", () => {
		const msg = message({
			providerSpam: { classified: false },
			authResult: { dmarc: "Pass" },
		});
		const verdict = classifyPlacement(msg, "junk", SenderTrust.Vip);
		assert.equal(verdict.action, "leave");
	});

	it("does not rescue when dmarc is not Pass", () => {
		const msg = message({
			providerSpam: { classified: true },
			authResult: { dmarc: "Fail" },
		});
		const verdict = classifyPlacement(msg, "junk", SenderTrust.Vip);
		assert.equal(verdict.action, "leave");
	});

	// Demote (inbox → junk), HIGH bar.
	it("demotes spam-in-inbox from an untrusted sender — dkim mismatch + dmarc=fail", () => {
		const msg = message({
			providerSpam: { classified: true },
			authResult: { dmarc: "Fail" },
			authenticity: { fromDomain: "bank.example", dkimMismatch: true },
		});
		const verdict = classifyPlacement(msg, "inbox", SenderTrust.Unknown);
		assert.equal(verdict.action, "move-to-junk");
		assert.equal(verdict.confidence, "confident");
	});

	it("leaves spam-in-inbox from a trusted sender even on dkim mismatch + dmarc=fail", () => {
		const msg = message({
			providerSpam: { classified: true },
			authResult: { dmarc: "Fail" },
			authenticity: { fromDomain: "bank.example", dkimMismatch: true },
		});
		const verdict = classifyPlacement(msg, "inbox", SenderTrust.Vip);
		assert.equal(verdict.action, "leave");
	});

	it("leaves sender/content mismatch in inbox without dmarc=fail (no dkim mismatch)", () => {
		const msg = message({
			providerSpam: { classified: true },
			authResult: { dmarc: "Neutral" },
			authenticity: { fromDomain: "example.com", dkimMismatch: false },
		});
		const verdict = classifyPlacement(msg, "inbox", SenderTrust.Unknown);
		assert.equal(verdict.action, "leave");
		assert.equal(verdict.confidence, "unsure");
	});

	it("does NOT auto-demote DMARC-pass phishing (dkim mismatch but dmarc=pass) — deferred to LLM", () => {
		const msg = message({
			providerSpam: { classified: true },
			authResult: { dmarc: "Pass" },
			authenticity: { fromDomain: "paypal.com", dkimMismatch: true },
		});
		const verdict = classifyPlacement(msg, "inbox", SenderTrust.Unknown);
		assert.equal(verdict.action, "leave");
		assert.equal(verdict.confidence, "unsure");
		assert.ok(verdict.reasons.includes("deferred-to-llm"));
	});

	// Guards.
	it("leaves a message already moved by Remit (re-act guard), confident", () => {
		const msg = message({
			movedByRemit: true,
			providerSpam: { classified: true },
			authResult: { dmarc: "Pass" },
		});
		const verdict = classifyPlacement(msg, "junk", SenderTrust.Vip);
		assert.equal(verdict.action, "leave");
		assert.equal(verdict.confidence, "confident");
	});

	it("leaves and is unsure when providerSpam is absent", () => {
		const msg = message({ authResult: { dmarc: "Pass" } });
		const verdict = classifyPlacement(msg, "junk", SenderTrust.Vip);
		assert.equal(verdict.action, "leave");
		assert.equal(verdict.confidence, "unsure");
	});

	it("leaves and is unsure when authResult is absent", () => {
		const msg = message({ providerSpam: { classified: true } });
		const verdict = classifyPlacement(msg, "junk", SenderTrust.Vip);
		assert.equal(verdict.action, "leave");
		assert.equal(verdict.confidence, "unsure");
	});

	it("leaves messages in 'other' folders with no confident signal", () => {
		const msg = message({
			providerSpam: { classified: true },
			authResult: { dmarc: "Pass" },
		});
		const verdict = classifyPlacement(msg, "other", SenderTrust.Vip);
		assert.equal(verdict.action, "leave");
	});
});
