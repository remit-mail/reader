import type {
	AddressFlags,
	AddressItem,
	CreateAddressInput,
	CreateEnvelopeAddressInput,
	EnvelopeAddressItem,
	FlagsMergePatch,
	IAddressRepository,
	ResultList,
	UpdateAddressInput,
} from "@remit/data-ports";
import { BadRequestError } from "@remit/data-ports/errors";
import type { JunkRoleMailboxes } from "@remit/data-ports/folder-role";
import { shouldPromoteWellknown } from "@remit/data-ports/wellknown";
import {
	and,
	asc,
	desc,
	eq,
	getTableColumns,
	gt,
	type SQL,
	sql,
} from "drizzle-orm";
import type { RepositoryDb } from "../db.js";
import { NotFoundError } from "../error.js";
import { envelopeAddressId } from "../id.js";
import { decodeToken, resultList } from "../pagination.js";
import {
	type BoundSql,
	JUNK_ONLY_FLAG,
	restoreSql,
	withholdSql,
} from "../repair/junk-only-address.js";
import { addressTable } from "../schema/i4-address.js";
import { envelopeAddressTable } from "../schema/message-data.js";
import {
	addressCorrespondence,
	addressListable,
	addressMatchRank,
	addressPreference,
	addressRecency,
	addressSearchMatch,
} from "./address-search-predicates.js";
import { inList } from "./in-list.js";

type DB = RepositoryDb<Record<string, unknown>>;

type AddressUpdate = Partial<{
	[K in keyof typeof addressTable.$inferInsert]:
		| (typeof addressTable.$inferInsert)[K]
		| SQL;
}>;

/** The stored flags as a JSON object: a row harvested before the column existed carries `''`. */
const storedFlags = sql<string>`coalesce(nullif(${addressTable.flags}, ''), '{}')`;

const flagPath = (key: string): string => `$.${key}`;

const withFlag = (flags: SQL, key: string, value: unknown): SQL =>
	sql`json_set(${flags}, ${flagPath(key)}, json(${JSON.stringify(value)}))`;

const withoutFlag = (flags: SQL, key: string): SQL =>
	sql`json_remove(${flags}, ${flagPath(key)})`;

const flagRaised = (flags: SQL, key: string): SQL =>
	sql`json_extract(${flags}, ${`$.${key}.value`}) = 1`;

/**
 * `blocked` and `neverSpam` are two directly contradictory statements about
 * where a sender's mail belongs (issue #605), so a row asserting both is not a
 * tie to break — it is a row that should not exist. This is the only place that
 * sees both keys at once: `buildFlagsPatch` stays a pure per-key translation,
 * and the merge expression is the one write that sees the whole map.
 *
 * The flag the patch just raised wins, so the instruction the user gave last is
 * the one that stands. A patch raising both resolves to `blocked` — the same
 * direction the `blocked`/`vip` same-second tie already breaks in.
 *
 * Only a patch that raises one of the two is allowed to drop the other. A row
 * that somehow already carries both survives a patch about anything else
 * untouched: dropping a placement instruction as a side effect of writing
 * `muted` would be a silent revocation the user never asked for. Such a row is
 * resolved on read — `resolveSenderPlacement` reads it as `Blocked` — and
 * healed the next time either key is written.
 */
const dropContradictedPlacementFlag = (
	flags: SQL,
	patch: FlagsMergePatch,
): SQL => {
	const kept =
		patch.blocked?.value === true
			? "blocked"
			: patch.neverSpam?.value === true
				? "neverSpam"
				: undefined;
	if (kept === undefined) return flags;
	const dropped = kept === "blocked" ? "neverSpam" : "blocked";
	return sql`case when ${flagRaised(flags, kept)} and ${flagRaised(flags, dropped)} then ${withoutFlag(flags, dropped)} else ${flags} end`;
};

/**
 * The stored `"<display name> <email>"` compound, folded in JavaScript exactly
 * as message sync folds it — SQL `lower()` stops at ASCII, and the search reads
 * this column expecting a full fold.
 */
const compoundOfSql = (displayName: string): SQL<string> =>
	sql<string>`trim(${displayName.toLowerCase()} || ' ' || ${addressTable.normalizedEmail})`;

/**
 * The order a suggestion list comes back in: where the term hit, then the
 * account's own standing for the sender, then how much it corresponds with it,
 * then how recently — and the stored compound and the id last, so the order is
 * total and a page boundary is a position rather than a guess.
 */
const searchOrder = (search: string | undefined) =>
	[
		{ key: "rank", expr: addressMatchRank(search), direction: "desc" },
		{ key: "preference", expr: addressPreference(), direction: "desc" },
		{ key: "correspondence", expr: addressCorrespondence(), direction: "desc" },
		{ key: "recency", expr: addressRecency(), direction: "desc" },
		{
			key: "normalizedCompound",
			expr: sql`${addressTable.normalizedCompound}`,
			direction: "asc",
		},
		{
			key: "addressId",
			expr: sql`${addressTable.addressId}`,
			direction: "asc",
		},
	] as const;

type SearchOrder = ReturnType<typeof searchOrder>;
type CursorPosition = Record<SearchOrder[number]["key"], number | string>;

const decodeAddressCursor = (
	cursor: string,
	order: SearchOrder,
): CursorPosition => {
	const decoded = decodeToken(cursor);
	const position = {} as Record<string, number | string>;
	for (const { key } of order) {
		const value = decoded[key];
		if (typeof value !== "number" && typeof value !== "string") {
			throw new BadRequestError("Invalid continuationToken");
		}
		position[key] = value;
	}
	return position as CursorPosition;
};

/**
 * Resume after a position in that order: strictly past the first key, or equal
 * on it and strictly past the rest.
 */
const after = (order: SearchOrder, position: CursorPosition): SQL => {
	const step = (index: number): SQL => {
		const { key, expr, direction } = order[index];
		const value = position[key];
		const past =
			direction === "desc" ? sql`${expr} < ${value}` : sql`${expr} > ${value}`;
		if (index === order.length - 1) return past;
		return sql`(${past} or (${expr} = ${value} and ${step(index + 1)}))`;
	};
	return step(0);
};

export function rowToAddress(
	row: typeof addressTable.$inferSelect,
): AddressItem {
	return {
		addressId: row.addressId,
		accountConfigId: row.accountConfigId,
		displayName: row.displayName ?? undefined,
		localPart: row.localPart,
		domain: row.domain,
		normalizedEmail: row.normalizedEmail,
		normalizedCompound: row.normalizedCompound,
		flags: (row.flags ?? {}) as AddressItem["flags"],
		inboundCount: row.inboundCount,
		outboundCount: row.outboundCount,
		replyCount: row.replyCount,
		lastInboundAt: row.lastInboundAt,
		lastOutboundAt: row.lastOutboundAt ?? undefined,
		lastReplyAt: row.lastReplyAt,
		createdAt: row.createdAt,
		updatedAt: row.updatedAt,
	};
}

function rowToEnvelopeAddress(
	row: typeof envelopeAddressTable.$inferSelect,
): EnvelopeAddressItem {
	return {
		envelopeAddressId: row.envelopeAddressId,
		messageId: row.messageId,
		addressId: row.addressId,
		displayName: row.displayName ?? undefined,
		normalizedEmail: row.normalizedEmail,
		addressRole: row.addressRole as EnvelopeAddressItem["addressRole"],
		addressOrder: row.addressOrder,
		createdAt: row.createdAt,
		updatedAt: row.updatedAt,
	};
}

const VIP_SUGGESTIONS_DEFAULT_LIMIT = 10;

const JUNK_HARVEST = "junk-harvest";
const JUNK_MOVE = "junk-move";

const withoutJunkOnlyFlagSql = (): SQL<string> =>
	sql<string>`json_remove(coalesce(nullif(${addressTable.flags}, ''), '{}'), ${`$.${JUNK_ONLY_FLAG}`})`;

const boundToDrizzle = (query: string, params: readonly unknown[]): SQL => {
	const chunks = query.split("?");
	const head = sql.raw(chunks[0]);
	return chunks
		.slice(1)
		.reduce(
			(acc, chunk, index) => sql`${acc}${params[index]}${sql.raw(chunk)}`,
			sql`${head}`,
		);
};

export class AddressRepo implements IAddressRepository {
	constructor(private db: DB) {}

	async createAddress(input: CreateAddressInput): Promise<AddressItem> {
		const now = Date.now();
		const [row] = await this.db
			.insert(addressTable)
			.values({
				addressId: input.addressId,
				accountConfigId: input.accountConfigId,
				displayName: input.displayName,
				localPart: input.localPart,
				domain: input.domain,
				normalizedEmail: input.normalizedEmail,
				normalizedCompound: input.normalizedCompound,
				flags: input.flags ?? {},
				inboundCount: input.inboundCount ?? 0,
				outboundCount: input.outboundCount ?? 0,
				replyCount: input.replyCount ?? 0,
				lastInboundAt: input.lastInboundAt ?? 0,
				lastOutboundAt: input.lastOutboundAt,
				lastReplyAt: input.lastReplyAt ?? 0,
				createdAt: now,
				updatedAt: now,
			})
			.returning();
		return rowToAddress(row);
	}

	/**
	 * Message sync sends `""` for a bare address, so a sighting carrying no
	 * display name must leave the stored one alone rather than erase it.
	 */
	async upsertAddress(input: CreateAddressInput): Promise<AddressItem> {
		const now = Date.now();
		const [row] = await this.db
			.insert(addressTable)
			.values({
				addressId: input.addressId,
				accountConfigId: input.accountConfigId,
				displayName: input.displayName,
				localPart: input.localPart,
				domain: input.domain,
				normalizedEmail: input.normalizedEmail,
				normalizedCompound: input.normalizedCompound,
				flags: input.flags ?? {},
				inboundCount: input.inboundCount ?? 0,
				outboundCount: input.outboundCount ?? 0,
				replyCount: input.replyCount ?? 0,
				lastInboundAt: input.lastInboundAt ?? 0,
				lastOutboundAt: input.lastOutboundAt,
				lastReplyAt: input.lastReplyAt ?? 0,
				createdAt: now,
				updatedAt: now,
			})
			.onConflictDoUpdate({
				target: addressTable.addressId,
				set: input.displayName
					? {
							displayName: input.displayName,
							normalizedCompound: input.normalizedCompound,
							updatedAt: now,
						}
					: { updatedAt: now },
			})
			.returning();
		return rowToAddress(row);
	}

	async upsertCorrespondentAddress(
		input: CreateAddressInput,
	): Promise<AddressItem> {
		const now = Date.now();
		const [row] = await this.db
			.insert(addressTable)
			.values({
				addressId: input.addressId,
				accountConfigId: input.accountConfigId,
				displayName: input.displayName,
				localPart: input.localPart,
				domain: input.domain,
				normalizedEmail: input.normalizedEmail,
				normalizedCompound: input.normalizedCompound,
				flags: input.flags ?? {},
				inboundCount: input.inboundCount ?? 0,
				outboundCount: input.outboundCount ?? 0,
				replyCount: input.replyCount ?? 0,
				lastInboundAt: input.lastInboundAt ?? 0,
				lastOutboundAt: input.lastOutboundAt,
				lastReplyAt: input.lastReplyAt ?? 0,
				createdAt: now,
				updatedAt: now,
			})
			.onConflictDoUpdate({
				target: addressTable.addressId,
				set: input.displayName
					? {
							displayName: input.displayName,
							normalizedCompound: input.normalizedCompound,
							flags: withoutJunkOnlyFlagSql(),
							updatedAt: now,
						}
					: { flags: withoutJunkOnlyFlagSql(), updatedAt: now },
			})
			.returning();
		return rowToAddress(row);
	}

	async upsertJunkAddress(input: CreateAddressInput): Promise<AddressItem> {
		const now = Date.now();
		const [row] = await this.db
			.insert(addressTable)
			.values({
				addressId: input.addressId,
				accountConfigId: input.accountConfigId,
				displayName: input.displayName,
				localPart: input.localPart,
				domain: input.domain,
				normalizedEmail: input.normalizedEmail,
				normalizedCompound: input.normalizedCompound,
				flags: {
					...(input.flags ?? {}),
					[JUNK_ONLY_FLAG]: { value: true, setAt: now, setBy: JUNK_HARVEST },
				},
				inboundCount: input.inboundCount ?? 0,
				outboundCount: input.outboundCount ?? 0,
				replyCount: input.replyCount ?? 0,
				lastInboundAt: input.lastInboundAt ?? 0,
				lastOutboundAt: input.lastOutboundAt,
				lastReplyAt: input.lastReplyAt ?? 0,
				createdAt: now,
				updatedAt: now,
			})
			.onConflictDoNothing()
			.returning();
		if (!row) return this.getAddress(input.accountConfigId, input.addressId);
		return rowToAddress(row);
	}

	async reconcileJunkOnlyForMessage(
		messageId: string,
		roles: JunkRoleMailboxes,
	): Promise<void> {
		const scope: BoundSql = {
			sql: ` AND address.address_id IN (
			SELECT address_id FROM envelope_address WHERE message_id = ?
		)`,
			params: [messageId],
		};
		const now = Date.now();
		const withhold = withholdSql(roles, now, JUNK_MOVE, scope);
		await this.db.run(boundToDrizzle(withhold.sql, withhold.params));
		const restore = restoreSql(roles, now, scope);
		await this.db.run(boundToDrizzle(restore.sql, restore.params));
	}

	async getAddress(
		accountConfigId: string,
		addressId: string,
	): Promise<AddressItem>;
	async getAddress(
		accountConfigId: string,
		addressIds: string[],
	): Promise<AddressItem[]>;
	async getAddress(
		accountConfigId: string,
		addressId: string | string[],
	): Promise<AddressItem | AddressItem[]> {
		if (Array.isArray(addressId)) {
			if (addressId.length === 0) return [];
			const rows = await this.db
				.select()
				.from(addressTable)
				.where(
					and(
						eq(addressTable.accountConfigId, accountConfigId),
						inList(addressTable.addressId, addressId),
					),
				);
			return rows.map(rowToAddress);
		}
		const [row] = await this.db
			.select()
			.from(addressTable)
			.where(
				and(
					eq(addressTable.accountConfigId, accountConfigId),
					eq(addressTable.addressId, addressId),
				),
			);
		if (!row) throw new NotFoundError(`Address not found: ${addressId}`);
		return rowToAddress(row);
	}

	async updateAddress(
		accountConfigId: string,
		addressId: string,
		input: UpdateAddressInput,
	): Promise<AddressItem> {
		const now = Date.now();
		const updates: AddressUpdate = { updatedAt: now };
		if (input.displayName !== undefined) {
			updates.displayName = input.displayName;
			updates.normalizedCompound = compoundOfSql(input.displayName);
		}
		if (input.flags !== undefined) updates.flags = input.flags as never;
		if (input.inboundCount !== undefined)
			updates.inboundCount = input.inboundCount;
		if (input.outboundCount !== undefined)
			updates.outboundCount = input.outboundCount;
		if (input.replyCount !== undefined) updates.replyCount = input.replyCount;
		if (input.lastInboundAt !== undefined)
			updates.lastInboundAt = input.lastInboundAt;
		if (input.lastOutboundAt !== undefined)
			updates.lastOutboundAt = input.lastOutboundAt;
		if (input.lastReplyAt !== undefined)
			updates.lastReplyAt = input.lastReplyAt;

		const [row] = await this.db
			.update(addressTable)
			.set(updates)
			.where(
				and(
					eq(addressTable.accountConfigId, accountConfigId),
					eq(addressTable.addressId, addressId),
				),
			)
			.returning();
		if (!row) throw new NotFoundError(`Address not found: ${addressId}`);
		return rowToAddress(row);
	}

	/**
	 * Fold a change into the stored flags in the one UPDATE that writes them:
	 * the change is a JSON expression over the column, so two concurrent merges
	 * each apply to what the other left and neither overwrites the other.
	 */
	private async mergeStoredFlags(
		accountConfigId: string,
		addressId: string,
		flags: SQL,
		extra: AddressUpdate = {},
	): Promise<AddressItem> {
		const [row] = await this.db
			.update(addressTable)
			.set({ ...extra, flags: flags as never, updatedAt: Date.now() })
			.where(
				and(
					eq(addressTable.accountConfigId, accountConfigId),
					eq(addressTable.addressId, addressId),
				),
			)
			.returning();
		if (!row) throw new NotFoundError(`Address not found: ${addressId}`);
		return rowToAddress(row);
	}

	async mergeFlags(
		accountConfigId: string,
		addressId: string,
		patch: FlagsMergePatch,
	): Promise<AddressItem> {
		const merged = Object.entries(patch).reduce<SQL>((flags, [key, value]) => {
			if (value === undefined) return flags;
			if (value === null) return withoutFlag(flags, key);
			return withFlag(flags, key, value);
		}, storedFlags);
		return this.mergeStoredFlags(
			accountConfigId,
			addressId,
			dropContradictedPlacementFlag(merged, patch),
		);
	}

	async promoteWellknownByUser(
		accountConfigId: string,
		addressId: string,
		now: number,
	): Promise<AddressItem> {
		return this.mergeStoredFlags(
			accountConfigId,
			addressId,
			withFlag(storedFlags, "wellknown", {
				value: true,
				setAt: now,
				setBy: "user-junk-rescue",
			}),
		);
	}

	async demoteSenderTrust(
		accountConfigId: string,
		addressId: string,
		_now: number,
	): Promise<AddressItem> {
		return this.mergeStoredFlags(
			accountConfigId,
			addressId,
			withoutFlag(withoutFlag(storedFlags, "wellknown"), "vip"),
			{ inboundCount: 0, replyCount: 0 },
		);
	}

	async deleteAddress(
		accountConfigId: string,
		addressId: string,
	): Promise<void> {
		await this.db
			.delete(addressTable)
			.where(
				and(
					eq(addressTable.accountConfigId, accountConfigId),
					eq(addressTable.addressId, addressId),
				),
			);
	}

	async incrementInboundCount(
		accountConfigId: string,
		addressId: string,
		now: number,
		isBulk?: boolean,
	): Promise<void> {
		const current = await this.getAddress(accountConfigId, addressId);
		const post = {
			...current,
			inboundCount: (current.inboundCount ?? 0) + 1,
			lastInboundAt: now,
			isBulk: isBulk ?? false,
		};
		if (shouldPromoteWellknown(post, now)) {
			const nextFlags: AddressFlags = {
				...(current.flags ?? {}),
				wellknown: { value: true, setAt: now, setBy: "auto-engagement" },
			};
			await this.db
				.update(addressTable)
				.set({
					inboundCount: sql`${addressTable.inboundCount} + 1`,
					lastInboundAt: now,
					flags: nextFlags as never,
					updatedAt: Date.now(),
				})
				.where(
					and(
						eq(addressTable.accountConfigId, accountConfigId),
						eq(addressTable.addressId, addressId),
					),
				);
		} else {
			await this.db
				.update(addressTable)
				.set({
					inboundCount: sql`${addressTable.inboundCount} + 1`,
					lastInboundAt: now,
					updatedAt: Date.now(),
				})
				.where(
					and(
						eq(addressTable.accountConfigId, accountConfigId),
						eq(addressTable.addressId, addressId),
					),
				);
		}
	}

	async incrementOutboundCount(
		accountConfigId: string,
		addressId: string,
		now: number,
	): Promise<void> {
		await this.db
			.update(addressTable)
			.set({
				outboundCount: sql`${addressTable.outboundCount} + 1`,
				lastOutboundAt: now,
				updatedAt: Date.now(),
			})
			.where(
				and(
					eq(addressTable.accountConfigId, accountConfigId),
					eq(addressTable.addressId, addressId),
				),
			);
	}

	async incrementReplyCount(
		accountConfigId: string,
		addressId: string,
		now: number,
	): Promise<void> {
		const current = await this.getAddress(accountConfigId, addressId);
		const post = {
			...current,
			replyCount: (current.replyCount ?? 0) + 1,
		};
		if (shouldPromoteWellknown(post, now)) {
			const nextFlags: AddressFlags = {
				...(current.flags ?? {}),
				wellknown: { value: true, setAt: now, setBy: "auto-engagement" },
			};
			await this.db
				.update(addressTable)
				.set({
					replyCount: sql`${addressTable.replyCount} + 1`,
					lastReplyAt: now,
					flags: nextFlags as never,
					updatedAt: Date.now(),
				})
				.where(
					and(
						eq(addressTable.accountConfigId, accountConfigId),
						eq(addressTable.addressId, addressId),
					),
				);
		} else {
			await this.db
				.update(addressTable)
				.set({
					replyCount: sql`${addressTable.replyCount} + 1`,
					lastReplyAt: now,
					updatedAt: Date.now(),
				})
				.where(
					and(
						eq(addressTable.accountConfigId, accountConfigId),
						eq(addressTable.addressId, addressId),
					),
				);
		}
	}

	async deleteManyAddresses(
		accountConfigId: string,
		addressIds: string[],
	): Promise<void> {
		if (addressIds.length === 0) return;
		await this.db
			.delete(addressTable)
			.where(
				and(
					eq(addressTable.accountConfigId, accountConfigId),
					inList(addressTable.addressId, addressIds),
				),
			);
	}

	async listSuggestedVips(input: {
		accountConfigId: string;
		limit?: number;
	}): Promise<AddressItem[]> {
		const { accountConfigId, limit = VIP_SUGGESTIONS_DEFAULT_LIMIT } = input;
		const rows = await this.db
			.select()
			.from(addressTable)
			.where(eq(addressTable.accountConfigId, accountConfigId));

		const candidates = rows
			.map(rowToAddress)
			.filter(
				(a) =>
					a.flags?.wellknown?.value === true &&
					a.flags?.vip?.value !== true &&
					(a.replyCount ?? 0) >= 1,
			)
			.sort((a, b) => {
				const aScore = (a.replyCount ?? 0) + (a.inboundCount ?? 0);
				const bScore = (b.replyCount ?? 0) + (b.inboundCount ?? 0);
				if (bScore !== aScore) return bScore - aScore;
				return (b.lastInboundAt ?? 0) - (a.lastInboundAt ?? 0);
			});

		return candidates.slice(0, limit);
	}

	async listByAccountConfig(input: {
		accountConfigId: string;
		search?: string;
		cursor?: string;
		limit?: number;
	}): Promise<ResultList<AddressItem>> {
		const { accountConfigId, search, cursor, limit = 100 } = input;
		const order = searchOrder(search);
		const position = cursor ? decodeAddressCursor(cursor, order) : undefined;

		const rows = await this.db
			.select({
				...getTableColumns(addressTable),
				rank: order[0].expr,
				preference: order[1].expr,
				correspondence: order[2].expr,
				recency: order[3].expr,
			})
			.from(addressTable)
			.where(
				and(
					eq(addressTable.accountConfigId, accountConfigId),
					search ? addressSearchMatch(search) : undefined,
					addressListable(search),
					position ? after(order, position) : undefined,
				),
			)
			.orderBy(
				...order.map(({ expr, direction }) =>
					direction === "desc" ? desc(expr) : asc(expr),
				),
			)
			.limit(limit + 1);

		const hasMore = rows.length > limit;
		const page = rows.slice(0, limit);
		const lastRow = page[page.length - 1];
		return resultList(
			page.map(rowToAddress),
			limit,
			hasMore && lastRow
				? {
						rank: lastRow.rank,
						preference: lastRow.preference,
						correspondence: lastRow.correspondence,
						recency: lastRow.recency,
						normalizedCompound: lastRow.normalizedCompound,
						addressId: lastRow.addressId,
					}
				: undefined,
		);
	}

	async listAllByAccountConfigPage(input: {
		accountConfigId: string;
		cursor?: string;
		limit?: number;
	}): Promise<ResultList<AddressItem>> {
		const { accountConfigId, cursor, limit = 100 } = input;
		const afterAddressId = cursor
			? (decodeToken(cursor).addressId as string)
			: undefined;

		const rows = await this.db
			.select()
			.from(addressTable)
			.where(
				and(
					eq(addressTable.accountConfigId, accountConfigId),
					afterAddressId
						? gt(addressTable.addressId, afterAddressId)
						: undefined,
				),
			)
			.orderBy(asc(addressTable.addressId))
			.limit(limit + 1);

		const hasMore = rows.length > limit;
		const items = rows.slice(0, limit).map(rowToAddress);
		const lastItem = items[items.length - 1];
		return resultList(
			items,
			limit,
			hasMore && lastItem ? { addressId: lastItem.addressId } : undefined,
		);
	}

	async listAllByAccountConfig(
		accountConfigId: string,
	): Promise<AddressItem[]> {
		const rows = await this.db
			.select()
			.from(addressTable)
			.where(eq(addressTable.accountConfigId, accountConfigId));
		return rows.map(rowToAddress);
	}

	async createEnvelopeAddress(
		input: CreateEnvelopeAddressInput,
	): Promise<EnvelopeAddressItem> {
		const now = Date.now();
		const [row] = await this.db
			.insert(envelopeAddressTable)
			.values({
				envelopeAddressId: envelopeAddressId(
					input.messageId,
					input.addressRole,
					input.addressOrder,
				),
				messageId: input.messageId,
				addressId: input.addressId,
				displayName: input.displayName,
				normalizedEmail: input.normalizedEmail,
				addressRole: input.addressRole,
				addressOrder: input.addressOrder,
				createdAt: now,
				updatedAt: now,
			})
			.returning();
		return rowToEnvelopeAddress(row);
	}

	async upsertEnvelopeAddress(
		input: CreateEnvelopeAddressInput,
	): Promise<EnvelopeAddressItem> {
		const now = Date.now();
		const rowId = envelopeAddressId(
			input.messageId,
			input.addressRole,
			input.addressOrder,
		);
		const [row] = await this.db
			.insert(envelopeAddressTable)
			.values({
				envelopeAddressId: rowId,
				messageId: input.messageId,
				addressId: input.addressId,
				displayName: input.displayName,
				normalizedEmail: input.normalizedEmail,
				addressRole: input.addressRole,
				addressOrder: input.addressOrder,
				createdAt: now,
				updatedAt: now,
			})
			.onConflictDoNothing()
			.returning();
		if (!row) {
			return this.getEnvelopeAddress(rowId);
		}
		return rowToEnvelopeAddress(row);
	}

	async getEnvelopeAddress(
		envelopeAddressId: string,
	): Promise<EnvelopeAddressItem>;
	async getEnvelopeAddress(
		envelopeAddressIds: string[],
	): Promise<EnvelopeAddressItem[]>;
	async getEnvelopeAddress(
		envelopeAddressId: string | string[],
	): Promise<EnvelopeAddressItem | EnvelopeAddressItem[]> {
		if (Array.isArray(envelopeAddressId)) {
			if (envelopeAddressId.length === 0) return [];
			const rows = await this.db
				.select()
				.from(envelopeAddressTable)
				.where(
					inList(envelopeAddressTable.envelopeAddressId, envelopeAddressId),
				);
			return rows.map(rowToEnvelopeAddress);
		}
		const [row] = await this.db
			.select()
			.from(envelopeAddressTable)
			.where(eq(envelopeAddressTable.envelopeAddressId, envelopeAddressId));
		if (!row)
			throw new NotFoundError(
				`EnvelopeAddress not found: ${envelopeAddressId}`,
			);
		return rowToEnvelopeAddress(row);
	}

	async deleteEnvelopeAddress(envelopeAddressId: string): Promise<void> {
		await this.db
			.delete(envelopeAddressTable)
			.where(eq(envelopeAddressTable.envelopeAddressId, envelopeAddressId));
	}

	async deleteManyEnvelopeAddresses(
		envelopeAddressIds: string[],
	): Promise<void> {
		if (envelopeAddressIds.length === 0) return;
		await this.db
			.delete(envelopeAddressTable)
			.where(
				inList(envelopeAddressTable.envelopeAddressId, envelopeAddressIds),
			);
	}
}
