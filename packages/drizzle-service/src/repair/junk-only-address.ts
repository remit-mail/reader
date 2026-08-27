import type { JunkRoleMailboxes } from "@remit/data-ports/folder-role";

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

export const JUNK_ONLY_FLAG = "junkOnly";

const STORED_FLAGS = "coalesce(nullif(address.flags, ''), '{}')";

const flagIsSet = (name: string): string =>
	`coalesce(json_extract(${STORED_FLAGS}, '$.${name}.value'), 0) = 1`;

const EMPTY: BoundSql = { sql: "", params: [] };

const MATCHES_NOTHING: BoundSql = { sql: "0 = 1", params: [] };

/**
 * Whether the message sits in one of these mailboxes. An empty list is
 * false — no mailbox holds the role, so no message is in one. That reading is
 * right for Trash and wrong for Junk, which is why an unresolvable Junk folder
 * is handled before this is ever reached.
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

/**
 * No account in scope has a Junk folder, so nothing is known about any
 * sighting: the mark cannot be earned. Silence is not the same as "every
 * message is live mail" — read that way, one move would restore every address
 * the sweep had withheld.
 */
const withholdable = (roles: JunkRoleMailboxes): BoundSql => {
	if (roles.junkMailboxIds.length === 0) return MATCHES_NOTHING;
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

/**
 * The same silence lifts no mark either — "stands on live mail" is
 * unanswerable without knowing which folder is Junk. Standing the account
 * gave the address itself still lifts it: that evidence needs no folder.
 */
const restorable = (roles: JunkRoleMailboxes): BoundSql => {
	if (roles.junkMailboxIds.length === 0) {
		return {
			sql: `${flagIsSet(JUNK_ONLY_FLAG)}
	AND ${ACCOUNT_HAS_CORRESPONDED}`,
			params: [],
		};
	}
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
	roles: JunkRoleMailboxes,
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
	roles: JunkRoleMailboxes,
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
	roles: JunkRoleMailboxes,
	now: number = Date.now(),
): Promise<JunkOnlyReport> => {
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
