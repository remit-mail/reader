import type { ThreadRowData, WizardMessage } from "@remit/ui";

/** A ticked row, as the wizard's samples and its clause prefill read it. */
export interface WizardSelectionMessage extends WizardMessage {
	/** Sender address — the widen's literal fallback and the prefill match on it. */
	email: string;
	/**
	 * Owning account, which a bulk run splits its batches by (#872) — the bulk
	 * endpoints refuse a batch spanning accounts before applying any of it.
	 * Stated by every surface rather than inferred: a per-mailbox list has one
	 * account for all its rows and carries none on the row, while the brief and
	 * Flagged span accounts and carry each row's own. Never `accountConfigId`,
	 * which every account of one user shares (#456).
	 */
	accountId: string | undefined;
}

/**
 * The ticked rows of a thread list, as the wizard reads them. The brief and
 * Flagged both list rows from every account and hand their selection over the
 * same way, so they read it from here rather than each keeping a copy that has
 * to learn about a new field twice.
 */
export const wizardSelectionFrom = (
	rows: readonly ThreadRowData[],
	selectedIds: ReadonlySet<string>,
): WizardSelectionMessage[] =>
	rows
		.filter((row) => selectedIds.has(row.id))
		.map((row) => ({
			id: row.id,
			sender: row.fromName,
			email: row.fromEmail,
			subject: row.subject,
			date: row.timeLabel,
			accountId: row.accountId,
		}));
