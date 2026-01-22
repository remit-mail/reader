import assert from "node:assert";
import { describe, it } from "node:test";
import {
	parseMailboxPath,
	validateMailboxOperation,
	validateMailboxPath,
} from "./mailbox-management.js";

describe("parseMailboxPath", () => {
	it("parses simple path", () => {
		const result = parseMailboxPath("INBOX");
		assert.strictEqual(result.name, "INBOX");
		assert.strictEqual(result.parent, null);
		assert.strictEqual(result.depth, 1);
	});

	it("parses nested path with default delimiter", () => {
		const result = parseMailboxPath("Work/Projects/ClientA");
		assert.strictEqual(result.name, "ClientA");
		assert.strictEqual(result.parent, "Work/Projects");
		assert.strictEqual(result.depth, 3);
	});

	it("parses nested path with custom delimiter", () => {
		const result = parseMailboxPath("Work.Projects.ClientA", ".");
		assert.strictEqual(result.name, "ClientA");
		assert.strictEqual(result.parent, "Work.Projects");
		assert.strictEqual(result.depth, 3);
	});

	it("handles two-level path", () => {
		const result = parseMailboxPath("Personal/Archive");
		assert.strictEqual(result.name, "Archive");
		assert.strictEqual(result.parent, "Personal");
		assert.strictEqual(result.depth, 2);
	});
});

describe("validateMailboxPath", () => {
	it("throws on empty path", () => {
		assert.throws(() => validateMailboxPath(""), {
			message: "Mailbox path cannot be empty",
		});
	});

	it("throws on whitespace-only path", () => {
		assert.throws(() => validateMailboxPath("   "), {
			message: "Mailbox path cannot be empty",
		});
	});

	it("throws on double delimiters", () => {
		assert.throws(() => validateMailboxPath("Work//Projects"), {
			message: "Mailbox path cannot contain empty hierarchy levels",
		});
	});

	it("throws on leading delimiter", () => {
		assert.throws(() => validateMailboxPath("/Work/Projects"), {
			message: "Mailbox path cannot start or end with hierarchy delimiter",
		});
	});

	it("throws on trailing delimiter", () => {
		assert.throws(() => validateMailboxPath("Work/Projects/"), {
			message: "Mailbox path cannot start or end with hierarchy delimiter",
		});
	});

	it("accepts valid simple path", () => {
		assert.doesNotThrow(() => validateMailboxPath("INBOX"));
	});

	it("accepts valid nested path", () => {
		assert.doesNotThrow(() => validateMailboxPath("Work/Projects/ClientA"));
	});
});

describe("validateMailboxOperation", () => {
	it("throws when deleting INBOX", () => {
		assert.throws(() => validateMailboxOperation("delete", "INBOX"), {
			message: "Cannot delete INBOX",
		});
	});

	it("throws when deleting INBOX (case insensitive)", () => {
		assert.throws(() => validateMailboxOperation("delete", "inbox"), {
			message: "Cannot delete INBOX",
		});
	});

	it("allows deleting other mailboxes", () => {
		assert.doesNotThrow(() => validateMailboxOperation("delete", "Archive"));
	});

	it("allows renaming INBOX", () => {
		assert.doesNotThrow(() => validateMailboxOperation("rename", "INBOX"));
	});

	it("allows renaming other mailboxes", () => {
		assert.doesNotThrow(() => validateMailboxOperation("rename", "Archive"));
	});
});
