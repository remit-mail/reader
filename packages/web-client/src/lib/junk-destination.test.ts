import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	ALREADY_IN_JUNK_REASON,
	junkDestination,
	junkWithheldReason,
	NO_JUNK_FOLDER_REASON,
} from "./junk-destination";

const JUNK = "mbx-junk";
const INBOX = "mbx-inbox";

describe("junkDestination", () => {
	it("is the appointed folder when the mail is somewhere else", () => {
		assert.equal(junkDestination(JUNK, INBOX), JUNK);
	});

	it("is nothing when the account appointed no Junk folder", () => {
		assert.equal(junkDestination(undefined, INBOX), undefined);
	});

	it("is nothing when the mail is already in the Junk folder", () => {
		assert.equal(junkDestination(JUNK, JUNK), undefined);
	});
});

describe("junkWithheldReason", () => {
	it("is nothing to say when the verb can act", () => {
		assert.equal(junkWithheldReason(JUNK, INBOX), undefined);
	});

	it("names the setting that appoints a folder", () => {
		assert.equal(junkWithheldReason(undefined, INBOX), NO_JUNK_FOLDER_REASON);
		assert.match(NO_JUNK_FOLDER_REASON, /Settings › Folder roles/);
	});

	it("says the mail is already where the verb would put it", () => {
		assert.equal(junkWithheldReason(JUNK, JUNK), ALREADY_IN_JUNK_REASON);
	});
});
