import { MailboxSpecialUse } from "@remit/domain-enums";

/**
 * Reconciling the addresses harvested out of a Junk folder (issue #822).
 *
 * Contact autocomplete offers every row in `address`, and sync wrote one for
 * every envelope address of every message it saw, Junk included. On the
 * instance that was hit, 517 of those rows exist only because a spam message
 * carried them, and one of them took private mail to a stranger (#826).
 *
 * Message sync now marks an address it first meets inside a Junk mailbox, and
 * clears the mark the moment it meets the same address anywhere else. That
 * reaches nothing already stored: `upsertAddress` never revisits a row it did
 * not have to write, so every row already harvested keeps standing. The same
 * decision therefore runs here, at boot, over the rows that are already there.
 *
 * The decision is relational rather than a predicate over one row's text: an
 * address is withheld when every message it has been seen on lives in a Junk
 * mailbox, and it is restored the moment one sighting lives anywhere else. SQL
 * is where that is decided because SQL is what can join the sighting to the
 * folder — there is no JS twin of it to disagree with.
 *
 * Two carve-outs sit above the join. An address with a non-zero
 * `outbound_count` or `reply_count` is one the account has written to or
 * replied to, and where a spam folder put the sender's mail says nothing about
 * that. A VIP is the account's own explicit standing for a sender. Neither is
 * ever withheld.
 *
 * Trash is deliberately not part of this. Deleted mail is largely
 * correspondence the account chose to be done with, not mail it never asked
 * for, and the address book is where "I once knew this person" belongs.
 *
 * Nothing is deleted. The repair sets and clears one flag, and the flag is the
 * only thing standing between the row and the suggestion list — clearing it
 * puts the address back exactly as it was. Both directions run on every boot,
 * so the flag can never outlive the evidence that set it.
 */

/**
 * The smallest surface this needs, so the module imports no schema and no
 * driver and can be driven by the migrator's `better-sqlite3` handle or a test.
 */
export interface JunkOnlyRepairClient {
	all(sql: string, params: unknown[]): Promise<unknown[]>;
	run(sql: string, params: unknown[]): Promise<number>;
}

export type JunkOnlyRepairMode = "check" | "repair";

export interface JunkOnlyReport {
	readonly mode: JunkOnlyRepairMode;
	readonly withholdable: number;
	readonly withheld: number;
	readonly restorable: number;
	readonly restored: number;
}

const REPAIR_SET_BY = "junk-only-repair";

const FLAGS = "coalesce(nullif(address.flags, ''), '{}')";

const flag = (name: string): string =>
	`coalesce(json_extract(${FLAGS}, '$.${name}.value'), 0)`;

/**
 * A mailbox the account's server designates as Junk. Both places the special
 * use is stored are read: the normalized entry rows are the entity, and the
 * `special_use` column is the copy the read paths use. A membership test over
 * the column is a substring match rather than `json_each` on purpose — the
 * column holds a JSON array of enum designations and nothing else, and
 * `json_each` raises on text that is not JSON, which on this table would fail
 * the whole migration over one malformed row.
 */
const JUNK_MAILBOX = `(
	exists (
		SELECT 1 FROM mailbox_special_use_entry entry
		WHERE entry.mailbox_id = message.mailbox_id
		  AND entry.special_use = '${MailboxSpecialUse.Junk}'
	)
	OR exists (
		SELECT 1 FROM mailbox
		WHERE mailbox.mailbox_id = message.mailbox_id
		  AND mailbox.special_use LIKE '%"${MailboxSpecialUse.Junk}"%'
	)
)`;

const sighting = (extra: string): string => `exists (
	SELECT 1 FROM envelope_address
	JOIN message ON message.message_id = envelope_address.message_id
	WHERE envelope_address.address_id = address.address_id${extra}
)`;

const ANY_SIGHTING = sighting("");
const SIGHTING_OUTSIDE_JUNK = sighting(` AND NOT ${JUNK_MAILBOX}`);

/** The account wrote to this address, replied to it, or named it a VIP. */
const CORRESPONDED = `(address.outbound_count > 0 OR address.reply_count > 0 OR ${flag("vip")} = 1)`;

const MARKED = `${flag("junkOnly")} = 1`;
const UNMARKED = `${flag("junkOnly")} = 0`;

const WITHHOLDABLE = `${UNMARKED}
	AND NOT ${CORRESPONDED}
	AND ${ANY_SIGHTING}
	AND NOT ${SIGHTING_OUTSIDE_JUNK}`;

const RESTORABLE = `${MARKED}
	AND (${CORRESPONDED} OR ${SIGHTING_OUTSIDE_JUNK})`;

const countOf = async (
	client: JunkOnlyRepairClient,
	predicate: string,
): Promise<number> => {
	const [row] = (await client.all(
		`SELECT count(*) AS row_count FROM address WHERE ${predicate}`,
		[],
	)) as { row_count: number }[];
	return row?.row_count ?? 0;
};

/**
 * The UPDATE runs only when the count found rows. SQLite takes its exclusive
 * write lock the moment an UPDATE begins, before it can know the WHERE matches
 * nothing, and a lock the migrator cannot get inside its `busy_timeout` fails
 * the migration and holds every gated service down. Zero is the steady state.
 */
export const sweepJunkOnlyAddresses = async (
	client: JunkOnlyRepairClient,
	mode: JunkOnlyRepairMode,
	now: number = Date.now(),
): Promise<JunkOnlyReport> => {
	const withholdable = await countOf(client, WITHHOLDABLE);
	const restorable = await countOf(client, RESTORABLE);

	if (mode === "check") {
		return { mode, withholdable, withheld: 0, restorable, restored: 0 };
	}

	const withheld =
		withholdable === 0
			? 0
			: await client.run(
					`UPDATE address
					 SET flags = json_set(${FLAGS}, '$.junkOnly',
						 json_object('value', json('true'), 'setAt', ?, 'setBy', '${REPAIR_SET_BY}')),
						 updated_at = ?
					 WHERE ${WITHHOLDABLE}`,
					[now, now],
				);

	const restored =
		restorable === 0
			? 0
			: await client.run(
					`UPDATE address
					 SET flags = json_remove(${FLAGS}, '$.junkOnly'), updated_at = ?
					 WHERE ${RESTORABLE}`,
					[now],
				);

	return { mode, withholdable, withheld, restorable, restored };
};

export const formatJunkOnlyReport = (report: JunkOnlyReport): string[] => {
	if (report.withholdable === 0 && report.restorable === 0) {
		return ["no address stands only on mail in Junk"];
	}
	const lines: string[] = [];
	if (report.withholdable > 0) {
		lines.push(
			report.mode === "check"
				? `${report.withholdable} address(es) stand only on mail in Junk, would be withheld from autocomplete`
				: `${report.withheld} of ${report.withholdable} address(es) standing only on mail in Junk withheld from autocomplete`,
		);
	}
	if (report.restorable > 0) {
		lines.push(
			report.mode === "check"
				? `${report.restorable} withheld address(es) now stand on mail outside Junk, would be restored`
				: `${report.restored} of ${report.restorable} withheld address(es) restored to autocomplete`,
		);
	}
	return lines;
};
