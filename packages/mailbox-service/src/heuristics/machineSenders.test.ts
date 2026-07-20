import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { hasMachineHeader, isMachineLocalPart } from "./machineSenders.js";

describe("isMachineLocalPart", () => {
	it("matches the no-reply spellings", () => {
		for (const localPart of [
			"noreply",
			"no-reply",
			"no_reply",
			"NoReply",
			"donotreply",
			"do-not-reply",
		]) {
			assert.equal(isMachineLocalPart(localPart), true, localPart);
		}
	});

	it("matches no-reply prefixes used by platforms", () => {
		for (const localPart of [
			"noreply-github",
			"no-reply+abc123",
			"messages-noreply",
		]) {
			assert.equal(isMachineLocalPart(localPart), true, localPart);
		}
	});

	it("matches notification and bounce mailboxes", () => {
		for (const localPart of [
			"notifications",
			"notify",
			"alerts",
			"bounces",
			"mailer-daemon",
			"postmaster",
		]) {
			assert.equal(isMachineLocalPart(localPart), true, localPart);
		}
	});

	it("does not match mailboxes a person answers", () => {
		// A wrong entry here silently buries real correspondence in `automated`,
		// which is the failure mode this whole change exists to remove.
		for (const localPart of [
			"support",
			"info",
			"contact",
			"hello",
			"sales",
			"alice",
			"team",
		]) {
			assert.equal(isMachineLocalPart(localPart), false, localPart);
		}
	});

	it("does not read a machine name across two words of a person's name", () => {
		// `bruno.reply` strips to "brunoreply", which contains "noreply" spanning
		// the boundary between the two words. Matching on whole words is what
		// keeps Bruno out of `automated`.
		for (const localPart of [
			"bruno.reply",
			"bruno-reply",
			"bruno_reply",
			"juno.replies",
			"toni.fyi",
			"bruno.reply+newsletter",
		]) {
			assert.equal(isMachineLocalPart(localPart), false, localPart);
		}
	});

	it("still matches the qualified machine forms", () => {
		for (const localPart of [
			"noreply-github",
			"messages-noreply",
			"jobalerts-noreply",
			"mailer.daemon",
			"do-not-reply",
			"team.notifications",
		]) {
			assert.equal(isMachineLocalPart(localPart), true, localPart);
		}
	});
});

describe("hasMachineHeader", () => {
	it("matches Feedback-ID regardless of case", () => {
		assert.equal(hasMachineHeader(["from", "Feedback-ID"]), true);
		assert.equal(hasMachineHeader(["feedback-id"]), true);
	});

	it("matches X-Auto-Response-Suppress", () => {
		assert.equal(hasMachineHeader(["x-auto-response-suppress"]), true);
	});

	it("does not match ordinary headers", () => {
		assert.equal(hasMachineHeader(["from", "to", "subject", "date"]), false);
	});
});
