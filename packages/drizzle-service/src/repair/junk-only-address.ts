import {
	type CanonicalMailboxRoleValue,
	composeFolderRoleAppointmentName,
	type RoleMailboxCandidate,
	resolveMailboxForRole,
} from "@remit/data-ports/folder-role";
import { CanonicalMailboxRole } from "@remit/domain-enums";

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

/** A statement or fragment with the values its `?` placeholders take, in order. */
export interface BoundSql {
	readonly sql: string;
	readonly params: readonly unknown[];
}

/**
 * The mailboxes holding the Junk and Trash roles, one per account, resolved by
 * `resolveMailboxForRole` — the same rule, and the same appointment, every
 * other special-folder lookup reads. SQL below compares mailbox ids against
 * these and never looks at a folder name, so the repair cannot answer "is this
 * message in Junk" differently from the code that harvested the address.
 */
export interface JunkOnlyRoleMailboxes {
	readonly junkMailboxIds: readonly string[];
	readonly trashMailboxIds: readonly string[];
}

export const JUNK_ONLY_FLAG = "junkOnly";

const STORED_FLAGS = "coalesce(nullif(address.flags, ''), '{}')";

const flagIsSet = (name: string): string =>
	`coalesce(json_extract(${STORED_FLAGS}, '$.${name}.value'), 0) = 1`;

const EMPTY: BoundSql = { sql: "", params: [] };

/**
 * An account with no resolvable folder for the role contributes no id, and an
 * empty id list must match no message at all: read the other way round it would
 * make every message in the instance junk, and withhold every contact.
 */
const inMailboxes = (mailboxIds: readonly string[]): BoundSql =>
	mailboxIds.length === 0
		? { sql: "(0 = 1)", params: [] }
		: {
				sql: `(message.mailbox_id IN (${mailboxIds.map(() => "?").join(", ")}))`,
				params: mailboxIds,
			};

const sightingWhere = (extra: string): string => `exists (
	SELECT 1 FROM envelope_address
	JOIN message ON message.message_id = envelope_address.message_id
	WHERE envelope_address.address_id = address.address_id${extra}
)`;

const ACCOUNT_HAS_CORRESPONDED = `(
	address.outbound_count > 0
	OR address.reply_count > 0
	OR ${flagIsSet("vip")}
	OR ${flagIsSet("trusted")}
)`;

const withholdable = (roles: JunkOnlyRoleMailboxes): BoundSql => {
	const inJunk = inMailboxes(roles.junkMailboxIds);
	const inTrash = inMailboxes(roles.trashMailboxIds);
	return {
		sql: `NOT ${flagIsSet(JUNK_ONLY_FLAG)}
	AND NOT ${ACCOUNT_HAS_CORRESPONDED}
	AND ${sightingWhere(` AND ${inJunk.sql}`)}
	AND NOT ${sightingWhere(` AND NOT ${inJunk.sql} AND NOT ${inTrash.sql}`)}`,
		params: [...inJunk.params, ...inJunk.params, ...inTrash.params],
	};
};

const restorable = (roles: JunkOnlyRoleMailboxes): BoundSql => {
	const inJunk = inMailboxes(roles.junkMailboxIds);
	const inTrash = inMailboxes(roles.trashMailboxIds);
	return {
		sql: `${flagIsSet(JUNK_ONLY_FLAG)}
	AND (${ACCOUNT_HAS_CORRESPONDED}
		OR ${sightingWhere(` AND NOT ${inJunk.sql} AND NOT ${inTrash.sql}`)})`,
		params: [...inJunk.params, ...inTrash.params],
	};
};

export const withholdSql = (
	roles: JunkOnlyRoleMailboxes,
	now: number,
	setBy: string,
	scope: BoundSql = EMPTY,
): BoundSql => {
	const predicate = withholdable(roles);
	return {
		sql: `UPDATE address
	 SET flags = json_set(${STORED_FLAGS}, '$.${JUNK_ONLY_FLAG}',
		   json_object('value', json('true'), 'setAt', CAST(? AS INTEGER), 'setBy', ?)),
		 updated_at = ?
	 WHERE ${predicate.sql}${scope.sql}`,
		params: [now, setBy, now, ...predicate.params, ...scope.params],
	};
};

export const restoreSql = (
	roles: JunkOnlyRoleMailboxes,
	now: number,
	scope: BoundSql = EMPTY,
): BoundSql => {
	const predicate = restorable(roles);
	return {
		sql: `UPDATE address
	 SET flags = json_remove(${STORED_FLAGS}, '$.${JUNK_ONLY_FLAG}'), updated_at = ?
	 WHERE ${predicate.sql}${scope.sql}`,
		params: [now, ...predicate.params, ...scope.params],
	};
};

const REPAIR_SET_BY = "junk-only-repair";

const isRow = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null;

const textOf = (row: Record<string, unknown>, column: string): string => {
	const value = row[column];
	if (typeof value !== "string") {
		throw new Error(`${column} is not text`);
	}
	return value;
};

const rowsOf = (rows: readonly unknown[]): Record<string, unknown>[] =>
	rows.map((row) => {
		if (!isRow(row)) throw new Error("query returned a non-row value");
		return row;
	});

const designationsByMailbox = async (
	client: JunkOnlyRepairClient,
): Promise<Map<string, string[]>> => {
	const rows = rowsOf(
		await client.all(
			"SELECT mailbox_id, special_use FROM mailbox_special_use_entry",
			[],
		),
	);
	const byMailbox = new Map<string, string[]>();
	for (const row of rows) {
		const mailboxId = textOf(row, "mailbox_id");
		const designations = byMailbox.get(mailboxId) ?? [];
		designations.push(textOf(row, "special_use"));
		byMailbox.set(mailboxId, designations);
	}
	return byMailbox;
};

const candidatesByAccount = async (
	client: JunkOnlyRepairClient,
): Promise<Map<string, RoleMailboxCandidate[]>> => {
	const [rows, designations] = await Promise.all([
		client
			.all(
				"SELECT mailbox_id, account_id, full_path, hierarchy_delimiter FROM mailbox",
				[],
			)
			.then(rowsOf),
		designationsByMailbox(client),
	]);
	const byAccount = new Map<string, RoleMailboxCandidate[]>();
	for (const row of rows) {
		const mailboxId = textOf(row, "mailbox_id");
		const accountId = textOf(row, "account_id");
		const candidates = byAccount.get(accountId) ?? [];
		candidates.push({
			mailboxId,
			fullPath: textOf(row, "full_path"),
			hierarchyDelimiter: textOf(row, "hierarchy_delimiter"),
			specialUse: designations.get(mailboxId) ?? [],
		});
		byAccount.set(accountId, candidates);
	}
	return byAccount;
};

const stringSettingsByName = async (
	client: JunkOnlyRepairClient,
): Promise<Map<string, string>> => {
	const rows = rowsOf(
		await client.all("SELECT name, value FROM account_setting", []),
	);
	const byName = new Map<string, string>();
	for (const row of rows) {
		const value: unknown = JSON.parse(textOf(row, "value"));
		if (!isRow(value)) continue;
		if (value.kind !== "String" || typeof value.value !== "string") continue;
		byName.set(textOf(row, "name"), value.value);
	}
	return byName;
};

/**
 * Every account's Junk and Trash folder, in one pass over the instance. The
 * sweep runs across accounts and mailbox ids are unique, so one union of ids
 * per role is exactly as selective as asking each account separately.
 */
const loadJunkOnlyRoleMailboxes = async (
	client: JunkOnlyRepairClient,
): Promise<JunkOnlyRoleMailboxes> => {
	const [byAccount, settings] = await Promise.all([
		candidatesByAccount(client),
		stringSettingsByName(client),
	]);

	const junkMailboxIds: string[] = [];
	const trashMailboxIds: string[] = [];
	for (const [accountId, candidates] of byAccount) {
		const appointed = (role: CanonicalMailboxRoleValue): string | undefined =>
			settings.get(composeFolderRoleAppointmentName(accountId, role));
		const junk = resolveMailboxForRole(
			CanonicalMailboxRole.Junk,
			candidates,
			appointed(CanonicalMailboxRole.Junk),
		);
		if (junk) junkMailboxIds.push(junk.mailboxId);
		const trash = resolveMailboxForRole(
			CanonicalMailboxRole.Trash,
			candidates,
			appointed(CanonicalMailboxRole.Trash),
		);
		if (trash) trashMailboxIds.push(trash.mailboxId);
	}
	return { junkMailboxIds, trashMailboxIds };
};

const countWhere = async (
	client: JunkOnlyRepairClient,
	predicate: BoundSql,
): Promise<number> => {
	const [row] = (await client.all(
		`SELECT count(*) AS row_count FROM address WHERE ${predicate.sql}`,
		predicate.params,
	)) as { row_count: number }[];
	return row?.row_count ?? 0;
};

export const sweepJunkOnlyAddresses = async (
	client: JunkOnlyRepairClient,
	mode: JunkOnlyRepairMode,
	now: number = Date.now(),
): Promise<JunkOnlyReport> => {
	const roles = await loadJunkOnlyRoleMailboxes(client);
	const withholdableCount = await countWhere(client, withholdable(roles));
	const restorableCount = await countWhere(client, restorable(roles));

	if (mode === "check") {
		return {
			mode,
			withholdable: withholdableCount,
			withheld: 0,
			restorable: restorableCount,
			restored: 0,
		};
	}

	const withhold = withholdSql(roles, now, REPAIR_SET_BY);
	const withheld =
		withholdableCount === 0
			? 0
			: await client.run(withhold.sql, withhold.params);

	const restore = restoreSql(roles, now);
	const restored =
		restorableCount === 0 ? 0 : await client.run(restore.sql, restore.params);

	return {
		mode,
		withholdable: withholdableCount,
		withheld,
		restorable: restorableCount,
		restored,
	};
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
