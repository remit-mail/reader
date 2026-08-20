import {
	JUNK_FOLDER_NAMES,
	TRASH_FOLDER_NAMES,
} from "@remit/data-ports/mailbox-role";
import { MailboxSpecialUse } from "@remit/domain-enums";

export interface JunkOnlyRepairClient {
	all(sql: string, params: readonly unknown[]): Promise<unknown[]>;
	run(sql: string, params: readonly unknown[]): Promise<number>;
}

export type JunkOnlyRepairMode = "check" | "repair";

export interface JunkOnlyReport {
	readonly mode: JunkOnlyRepairMode;
	readonly withholdable: number;
	readonly withheld: number;
	readonly restorable: number;
	readonly restored: number;
}

export const JUNK_ONLY_FLAG = "junkOnly";

const STORED_FLAGS = "coalesce(nullif(address.flags, ''), '{}')";

const flagIsSet = (name: string): string =>
	`coalesce(json_extract(${STORED_FLAGS}, '$.${name}.value'), 0) = 1`;

const quoted = (names: readonly string[]): string =>
	names.map((name) => `'${name}'`).join(", ");

const MAILBOX_LEAF = `lower(substr(
		mailbox.full_path,
		length(rtrim(
			mailbox.full_path,
			replace(mailbox.full_path, mailbox.hierarchy_delimiter, '')
		)) + 1
	))`;

const mailboxCarriesRole = (
	specialUse: string,
	names: readonly string[],
): string => `(
	exists (
		SELECT 1 FROM mailbox_special_use_entry entry
		WHERE entry.mailbox_id = message.mailbox_id
		  AND entry.special_use = '${specialUse}'
	)
	OR exists (
		SELECT 1 FROM mailbox
		WHERE mailbox.mailbox_id = message.mailbox_id
		  AND (
			mailbox.special_use LIKE '%"${specialUse}"%'
			OR ${MAILBOX_LEAF} IN (${quoted(names)})
		  )
	)
)`;

const IN_JUNK = mailboxCarriesRole(MailboxSpecialUse.Junk, JUNK_FOLDER_NAMES);
const IN_TRASH = mailboxCarriesRole(
	MailboxSpecialUse.Trash,
	TRASH_FOLDER_NAMES,
);

const sightingWhere = (extra: string): string => `exists (
	SELECT 1 FROM envelope_address
	JOIN message ON message.message_id = envelope_address.message_id
	WHERE envelope_address.address_id = address.address_id${extra}
)`;

const SIGHTING_IN_JUNK = sightingWhere(` AND ${IN_JUNK}`);
const SIGHTING_IN_LIVE_MAIL = sightingWhere(
	` AND NOT ${IN_JUNK} AND NOT ${IN_TRASH}`,
);

/**
 * Standing on live mail other than one named message. `message.mailbox_id` is
 * where Reader last wrote the message down, not where it is: a `messageId` is
 * folder-independent, and a save that meets an already-stored message in a
 * second folder leaves the stored row pointing at the first. So the message a
 * caller has just met in Junk still reads as INBOX here, and reading it would
 * have the sighting refute itself (#859).
 */
const SIGHTING_IN_LIVE_MAIL_ELSEWHERE = sightingWhere(
	` AND envelope_address.message_id <> ? AND NOT ${IN_JUNK} AND NOT ${IN_TRASH}`,
);

export const ACCOUNT_HAS_CORRESPONDED = `(
	address.outbound_count > 0
	OR address.reply_count > 0
	OR ${flagIsSet("vip")}
	OR ${flagIsSet("trusted")}
)`;

export const WITHHOLDABLE = `NOT ${flagIsSet(JUNK_ONLY_FLAG)}
	AND NOT ${ACCOUNT_HAS_CORRESPONDED}
	AND ${SIGHTING_IN_JUNK}
	AND NOT ${SIGHTING_IN_LIVE_MAIL}`;

/**
 * A sighting of the message in Junk is the caller's own observation, so the
 * only question left is whether the sender stands on anything else.
 */
const WITHHOLDABLE_SEEN_IN_JUNK = `NOT ${flagIsSet(JUNK_ONLY_FLAG)}
	AND NOT ${ACCOUNT_HAS_CORRESPONDED}
	AND NOT ${SIGHTING_IN_LIVE_MAIL_ELSEWHERE}`;

export const RESTORABLE = `${flagIsSet(JUNK_ONLY_FLAG)}
	AND (${ACCOUNT_HAS_CORRESPONDED} OR ${SIGHTING_IN_LIVE_MAIL})`;

/** Attributions the mark carries, naming what put it there. */
const REPAIR_SET_BY = "junk-only-repair";
export const JUNK_SIGHTING_SET_BY = "junk-sighting";

const MARK_FROM_SIGHTING = `coalesce(json_extract(${STORED_FLAGS}, '$.${JUNK_ONLY_FLAG}.setBy'), '') = '${JUNK_SIGHTING_SET_BY}'`;

/**
 * The sweep re-derives the mark from stored rows, and a sender marked because
 * another client filed its mail into Junk stands on a message whose stored row
 * still names the folder it arrived in. Reading that as live mail would lift
 * the mark at every boot, so the sweep leaves an observed sighting alone and
 * only a favourable opinion lifts it (#859).
 */
const SWEEP_RESTORABLE = `${flagIsSet(JUNK_ONLY_FLAG)}
	AND (${ACCOUNT_HAS_CORRESPONDED}
	  OR (${SIGHTING_IN_LIVE_MAIL} AND NOT ${MARK_FROM_SIGHTING}))`;

const withholdUpdate = (predicate: string): string =>
	`UPDATE address
	 SET flags = json_set(${STORED_FLAGS}, '$.${JUNK_ONLY_FLAG}',
		   json_object('value', json('true'), 'setAt', CAST(? AS INTEGER), 'setBy', ?)),
		 updated_at = ?
	 WHERE ${predicate}`;

const restoreUpdate = (predicate: string): string =>
	`UPDATE address
	 SET flags = json_remove(${STORED_FLAGS}, '$.${JUNK_ONLY_FLAG}'), updated_at = ?
	 WHERE ${predicate}`;

export const withholdSql = (scope = ""): string =>
	withholdUpdate(`${WITHHOLDABLE}${scope}`);

export const withholdSeenInJunkSql = (scope = ""): string =>
	withholdUpdate(`${WITHHOLDABLE_SEEN_IN_JUNK}${scope}`);

export const restoreSql = (scope = ""): string =>
	restoreUpdate(`${RESTORABLE}${scope}`);

const countWhere = async (
	client: JunkOnlyRepairClient,
	predicate: string,
): Promise<number> => {
	const [row] = (await client.all(
		`SELECT count(*) AS row_count FROM address WHERE ${predicate}`,
		[],
	)) as { row_count: number }[];
	return row?.row_count ?? 0;
};

export const sweepJunkOnlyAddresses = async (
	client: JunkOnlyRepairClient,
	mode: JunkOnlyRepairMode,
	now: number = Date.now(),
): Promise<JunkOnlyReport> => {
	const withholdable = await countWhere(client, WITHHOLDABLE);
	const restorable = await countWhere(client, SWEEP_RESTORABLE);

	if (mode === "check") {
		return { mode, withholdable, withheld: 0, restorable, restored: 0 };
	}

	const withheld =
		withholdable === 0
			? 0
			: await client.run(withholdSql(), [now, REPAIR_SET_BY, now]);

	const restored =
		restorable === 0
			? 0
			: await client.run(restoreUpdate(SWEEP_RESTORABLE), [now]);

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
				? `${report.restorable} withheld address(es) now stand on live mail, would be restored`
				: `${report.restored} of ${report.restorable} withheld address(es) restored to autocomplete`,
		);
	}
	return lines;
};
