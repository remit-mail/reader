/**
 * What a message list does with a verb the keyboard aimed at it (#477 1.4,
 * #508, #522). Pure, so the routing is testable without the DOM, the router and
 * the data hooks a list wires together.
 */

import type { Verb } from "@remit/ui";
import { junkWithheldReason } from "./junk-destination";

/**
 * - `openWizard` — the selection walks the wizard, which is where a bulk action
 *   is reviewed before it reaches the mail server.
 * - `confirmDelete` — the one verb a bare cursor keeps, with its confirmation.
 * - `withheld` — the press belongs to what is already on screen: the delete
 *   confirmation is asking, and answering it is the Confirm button's job.
 * - `unavailable` — the verb cannot act on this mail from here, and this is why.
 *   The list takes the press and says so, rather than leaving a shortcut that
 *   silently does nothing.
 * - `declined` — not the list's press, so the pane acts on the focused row.
 */
export type ListVerbRequest =
	| { kind: "openWizard" }
	| { kind: "confirmDelete"; messageId: string }
	| { kind: "withheld" }
	| { kind: "unavailable"; reason: string }
	| { kind: "declined" };

export interface ListVerbReading {
	verb: Verb;
	/** The delete confirmation is on screen. */
	confirmingDelete: boolean;
	hasSelection: boolean;
	/** The account's appointed Junk folder, when it has appointed one. */
	junkMailboxId: string | undefined;
	/** The mailbox the rows are in, which the Junk destination cannot also be. */
	currentMailboxId: string | undefined;
	/** The row under the cursor, when this surface can delete it. */
	deletableMessageId: string | undefined;
}

export const listVerbRequest = ({
	verb,
	confirmingDelete,
	hasSelection,
	junkMailboxId,
	currentMailboxId,
	deletableMessageId,
}: ListVerbReading): ListVerbRequest => {
	if (confirmingDelete) return { kind: "withheld" };
	// Junk with nowhere to file into is kept off the keyboard exactly as the bar
	// keeps it off the screen. Opening the wizard on it instead ends on a commit
	// that resolves no destination, whatever is ticked (#522).
	if (verb === "junk") {
		const reason = junkWithheldReason(junkMailboxId, currentMailboxId);
		if (reason !== undefined) return { kind: "unavailable", reason };
	}
	if (hasSelection) return { kind: "openWizard" };
	if (verb !== "delete" || deletableMessageId === undefined) {
		return { kind: "declined" };
	}
	return { kind: "confirmDelete", messageId: deletableMessageId };
};
