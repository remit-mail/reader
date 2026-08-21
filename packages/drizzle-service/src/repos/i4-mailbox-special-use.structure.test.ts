import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

/**
 * The path a stale appointment last pointed at is a display-only sibling row
 * (`FolderRoleAppointmentLabel`, #887). "Never read by resolution" is meant to
 * be structural rather than a habit: this repository composes one setting name
 * and has no way to reach the other. Read the source to prove it, because the
 * guarantee is about what the file cannot do, not about what any one call
 * returns.
 */
describe("MailboxSpecialUseRepo and the appointment label row", () => {
	const source = readFileSync(
		new URL("./i4-mailbox-special-use.ts", import.meta.url),
		"utf8",
	);

	it("never names the label setting", () => {
		assert.equal(source.includes("FolderRoleAppointmentLabel"), false);
		assert.equal(
			source.includes("composeFolderRoleAppointmentLabelName"),
			false,
		);
	});

	it("composes the appointment name in exactly one place", () => {
		const uses = source.split("composeFolderRoleAppointmentName(").length - 1;
		assert.equal(uses, 1);
	});
});
