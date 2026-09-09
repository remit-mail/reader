/**
 * Tests for `resolveAuthenticityVerdict` — the pure tier-ordered derivation
 * for `Message.authenticityVerdict` (issue #1197).
 *
 * The tier order from the typespec doc is first-match-wins:
 * Impersonation → Aligned → Authenticated → Routine → NotChecked → Caution.
 * `NotEvaluated` is never returned — it is the "never derived" sentinel.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { AddressItem, SenderSignerStandingItem } from "@remit/data-ports";
import {
	deriveStandingPair,
	resolveAuthenticityVerdict,
	senderTrusted,
} from "./resolveAuthenticityVerdict.js";

const STANDING: SenderSignerStandingItem = {
	accountConfigId: "cfg-1",
	senderKey: "example.com",
	signerDomain: "example.com",
	messageCount: 5,
	firstSeenAt: 100,
	lastSeenAt: 200,
	userAffirmedAt: 0,
	createdAt: 50,
	updatedAt: 200,
} as unknown as SenderSignerStandingItem;

const TRUSTED_FLAGS: AddressItem["flags"] = {
	trusted: { value: true, setAt: 1 },
} as unknown as AddressItem["flags"];

const parse = async (raw: string) =>
	import("mailparser").then((m) => m.simpleParser(Buffer.from(raw)));

describe("resolveAuthenticityVerdict (issue #1197)", () => {
	describe("Impersonation — tier 1", () => {
		it("flags a missing From address", async () => {
			const parsed = await parse(["Subject: hi", "", "body"].join("\r\n"));
			assert.equal(
				resolveAuthenticityVerdict(parsed, null, undefined),
				"Impersonation",
			);
		});

		it("flags a DMARC fail in Authentication-Results", async () => {
			const parsed = await parse(
				[
					"From: someone@example.com",
					"Authentication-Results: mx.example.com; dmarc=fail",
					"",
					"body",
				].join("\r\n"),
			);
			assert.equal(
				resolveAuthenticityVerdict(parsed, null, undefined),
				"Impersonation",
			);
		});
	});

	describe("Aligned — tier 2", () => {
		it("returns Aligned when DKIM d= matches the From domain", async () => {
			const parsed = await parse(
				[
					"From: someone@example.com",
					"DKIM-Signature: v=1; d=example.com; s=sel; b=xxx",
					"",
					"body",
				].join("\r\n"),
			);
			assert.equal(
				resolveAuthenticityVerdict(parsed, null, undefined),
				"Aligned",
			);
		});
	});

	describe("Authenticated — tier 3", () => {
		it("returns Authenticated when SPF passes and Return-Path aligns", async () => {
			const parsed = await parse(
				[
					"From: someone@example.com",
					"Authentication-Results: mx.example.com; spf=pass",
					"Return-Path: <bounce@example.com>",
					"",
					"body",
				].join("\r\n"),
			);
			assert.equal(
				resolveAuthenticityVerdict(parsed, null, undefined),
				"Authenticated",
			);
		});
	});

	describe("Routine — tier 4", () => {
		it("returns Routine for a misaligned DKIM with standing", async () => {
			const parsed = await parse(
				[
					"From: someone@example.com",
					"DKIM-Signature: v=1; d=other.example.net; s=sel; b=xxx",
					"",
					"body",
				].join("\r\n"),
			);
			assert.equal(
				resolveAuthenticityVerdict(parsed, STANDING, undefined),
				"Routine",
			);
		});
	});

	describe("NotChecked — tier 5", () => {
		it("returns NotChecked for unsigned mail with standing", async () => {
			const parsed = await parse(
				["From: someone@example.com", "", "body"].join("\r\n"),
			);
			assert.equal(
				resolveAuthenticityVerdict(parsed, STANDING, undefined),
				"NotChecked",
			);
		});
	});

	describe("Caution — tier 6 (fallthrough)", () => {
		it("returns Caution for unsigned mail with no standing", async () => {
			const parsed = await parse(
				["From: someone@example.com", "", "body"].join("\r\n"),
			);
			assert.equal(
				resolveAuthenticityVerdict(parsed, null, undefined),
				"Caution",
			);
		});
	});

	describe("senderTrusted", () => {
		it("returns true when standing exists", () => {
			assert.equal(senderTrusted(STANDING, undefined), true);
		});

		it("returns true when flags.trusted is true", () => {
			assert.equal(senderTrusted(null, TRUSTED_FLAGS), true);
		});

		it("returns false when neither standing nor flags", () => {
			assert.equal(senderTrusted(null, undefined), false);
		});
	});

	describe("deriveStandingPair", () => {
		it("returns the From-domain / signer-domain pair when DKIM exists", async () => {
			const parsed = await parse(
				[
					"From: someone@example.com",
					"DKIM-Signature: v=1; d=mail.example.net; s=sel; b=xxx",
					"",
					"body",
				].join("\r\n"),
			);
			assert.deepEqual(deriveStandingPair(parsed), {
				senderKey: "example.com",
				signerDomain: "example.net",
			});
		});

		it("returns the address-keyed unverified pair when no DKIM", async () => {
			const parsed = await parse(
				["From: someone@example.com", "", "body"].join("\r\n"),
			);
			assert.deepEqual(deriveStandingPair(parsed), {
				senderKey: "someone@example.com",
				signerDomain: "unverified",
			});
		});

		it("returns null when the From address is unreadable", async () => {
			const parsed = await parse(["Subject: hi", "", "body"].join("\r\n"));
			assert.equal(deriveStandingPair(parsed), null);
		});
	});
});
