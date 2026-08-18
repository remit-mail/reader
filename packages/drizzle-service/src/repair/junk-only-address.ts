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

const quoted = (paths: readonly string[]): string =>
	paths.map((path) => `'${path}'`).join(", ");

const mailboxCarriesRole = (
	specialUse: string,
	paths: readonly string[],
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
			OR lower(mailbox.full_path) IN (${quoted(paths)})
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

const ANY_SIGHTING = sightingWhere("");
const SIGHTING_IN_LIVE_MAIL = sightingWhere(
	` AND NOT ${IN_JUNK} AND NOT ${IN_TRASH}`,
);
const EVERY_SIGHTING_IN_JUNK = `NOT ${sightingWhere(` AND NOT ${IN_JUNK}`)}`;

export const ACCOUNT_HAS_TAKEN_A_POSITION = `(
	address.outbound_count > 0
	OR address.reply_count > 0
	OR ${flagIsSet("vip")}
	OR ${flagIsSet("trusted")}
	OR ${flagIsSet("blocked")}
	OR ${flagIsSet("muted")}
)`;

export const WITHHOLDABLE = `NOT ${flagIsSet(JUNK_ONLY_FLAG)}
	AND NOT ${ACCOUNT_HAS_TAKEN_A_POSITION}
	AND ${ANY_SIGHTING}
	AND ${EVERY_SIGHTING_IN_JUNK}`;

export const RESTORABLE = `${flagIsSet(JUNK_ONLY_FLAG)}
	AND (${ACCOUNT_HAS_TAKEN_A_POSITION} OR ${SIGHTING_IN_LIVE_MAIL})`;

export const withholdSql = (scope = ""): string =>
	`UPDATE address
	 SET flags = json_set(${STORED_FLAGS}, '$.${JUNK_ONLY_FLAG}',
		   json_object('value', json('true'), 'setAt', CAST(? AS INTEGER), 'setBy', ?)),
		 updated_at = ?
	 WHERE ${WITHHOLDABLE}${scope}`;

export const restoreSql = (scope = ""): string =>
	`UPDATE address
	 SET flags = json_remove(${STORED_FLAGS}, '$.${JUNK_ONLY_FLAG}'), updated_at = ?
	 WHERE ${RESTORABLE}${scope}`;

const REPAIR_SET_BY = "junk-only-repair";

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
	const restorable = await countWhere(client, RESTORABLE);

	if (mode === "check") {
		return { mode, withholdable, withheld: 0, restorable, restored: 0 };
	}

	const withheld =
		withholdable === 0
			? 0
			: await client.run(withholdSql(), [now, REPAIR_SET_BY, now]);

	const restored = restorable === 0 ? 0 : await client.run(restoreSql(), [now]);

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
