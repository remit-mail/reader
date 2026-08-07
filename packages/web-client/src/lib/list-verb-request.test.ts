import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Verb } from "@remit/ui";
import {
	ALREADY_IN_JUNK_REASON,
	NO_JUNK_FOLDER_REASON,
} from "./junk-destination";
import { type ListVerbReading, listVerbRequest } from "./list-verb-request";

const JUNK = "mbx-junk";
const INBOX = "mbx-inbox";

const reading = (over: Partial<ListVerbReading> = {}): ListVerbReading => ({
	verb: "junk",
	confirmingDelete: false,
	hasSelection: true,
	junkMailboxId: JUNK,
	currentMailboxId: INBOX,
	deletableMessageId: undefined,
	...over,
});

const VERBS: Verb[] = ["delete", "move", "junk", "markRead", "organize"];

describe("listVerbRequest", () => {
	it("opens the wizard for every verb over a selection", () => {
		for (const verb of VERBS) {
			assert.deepEqual(
				listVerbRequest(reading({ verb })),
				{ kind: "openWizard" },
				verb,
			);
		}
	});

	it("leaves a verb aimed at the bare cursor to the pane, except delete", () => {
		for (const verb of VERBS.filter((each) => each !== "delete")) {
			assert.deepEqual(
				listVerbRequest(
					reading({ verb, hasSelection: false, deletableMessageId: "m1" }),
				),
				{ kind: "declined" },
				verb,
			);
		}
		assert.deepEqual(
			listVerbRequest(
				reading({
					verb: "delete",
					hasSelection: false,
					deletableMessageId: "m1",
				}),
			),
			{ kind: "confirmDelete", messageId: "m1" },
		);
	});

	it("declines a delete the surface cannot make", () => {
		assert.deepEqual(
			listVerbRequest(
				reading({
					verb: "delete",
					hasSelection: false,
					deletableMessageId: undefined,
				}),
			),
			{ kind: "declined" },
		);
	});

	it("claims a second delete rather than letting it past the confirmation", () => {
		assert.deepEqual(
			listVerbRequest(reading({ verb: "delete", confirmingDelete: true })),
			{ kind: "withheld" },
		);
	});

	/**
	 * #522. The bar withholds Junk on exactly these two readings; the keyboard
	 * used to claim the press regardless and open the wizard on a verb whose
	 * commit then resolved no destination — ending on a Try again that re-sent the
	 * identical commit forever.
	 */
	describe("Junk with nowhere to file into", () => {
		it("is withheld over a selection when no Junk folder is appointed", () => {
			assert.deepEqual(listVerbRequest(reading({ junkMailboxId: undefined })), {
				kind: "unavailable",
				reason: NO_JUNK_FOLDER_REASON,
			});
		});

		it("is withheld over a selection inside the Junk folder itself", () => {
			assert.deepEqual(listVerbRequest(reading({ currentMailboxId: JUNK })), {
				kind: "unavailable",
				reason: ALREADY_IN_JUNK_REASON,
			});
		});

		it("is withheld over a bare cursor too, rather than falling to the pane", () => {
			// Declining here hands the press to the pane, which moves the focused row
			// into the folder it is already in and reports it as done.
			assert.deepEqual(
				listVerbRequest(
					reading({
						hasSelection: false,
						currentMailboxId: JUNK,
						deletableMessageId: "m1",
					}),
				),
				{ kind: "unavailable", reason: ALREADY_IN_JUNK_REASON },
			);
		});

		it("withholds nothing else on the same reading", () => {
			for (const verb of VERBS.filter((each) => each !== "junk")) {
				assert.deepEqual(
					listVerbRequest(reading({ verb, junkMailboxId: undefined })),
					{ kind: "openWizard" },
					verb,
				);
			}
		});
	});
});
