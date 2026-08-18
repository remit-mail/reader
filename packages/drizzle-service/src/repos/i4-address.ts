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
import {
	and,
	asc,
	desc,
	eq,
	getTableColumns,
	inArray,
	type SQL,
	sql,
} from "drizzle-orm";
import type { Db } from "../db.js";
import { NotFoundError } from "../error.js";
import { envelopeAddressId as deriveEnvelopeAddressId } from "../id.js";
import { decodeToken, resultList } from "../pagination.js";
import { addressTable } from "../schema/i4-address.js";
import { envelopeAddressTable } from "../schema/message-data.js";
import {
	addressCorrespondence,
	addressMatchRank,
	addressPreference,
	addressRecency,
	addressSearchMatch,
	addressSuggestible,
} from "./address-search-predicates.js";
import { shouldPromoteWellknown } from "./i4-address-wellknown.js";

type DB = Db<Record<string, unknown>>;

type AddressUpdate = Partial<{
	[K in keyof typeof addressTable.$inferInsert]:
		| (typeof addressTable.$inferInsert)[K]
		| SQL;
}>;

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

/**
 * The stored flags with the autocomplete withholding mark dropped, computed in
 * SQL so a sighting clears it in the same statement that records the sighting.
 * The empty-string guard is the same one the search predicates carry: a row
 * written before `flags` was always populated holds `''`, and `json_remove`
 * raises on text that is not JSON.
 */
const withoutJunkOnlySql = (): SQL<string> =>
	sql<string>`json_remove(coalesce(nullif(${addressTable.flags}, ''), '{}'), '$.junkOnly')`;

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
	 *
	 * Every write here is a sighting outside Junk — sync routes the others to
	 * {@link upsertJunkAddress} — so it also clears the mark that withholds a
	 * row from autocomplete (#822). One sighting in the ordinary mail is the
	 * whole evidence the mark was ever waiting for.
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
							flags: withoutJunkOnlySql(),
							updatedAt: now,
						}
					: { flags: withoutJunkOnlySql(), updatedAt: now },
			})
			.returning();
		return rowToAddress(row);
	}

	/**
	 * An address met on a message that lives in a Junk mailbox. The row is
	 * written so the message renders its own From, To and Cc, and marked so
	 * autocomplete withholds it (#822).
	 *
	 * An existing row is left exactly as it stands — not even the display name.
	 * A sighting in Junk is no evidence about an address the account already
	 * knows, and the name on it was chosen by whoever sent the spam.
	 */
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
					junkOnly: { value: true, setAt: now, setBy: JUNK_HARVEST },
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
						inArray(addressTable.addressId, addressId),
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

	async mergeFlags(
		accountConfigId: string,
		addressId: string,
		patch: FlagsMergePatch,
	): Promise<AddressItem> {
		const current = await this.getAddress(accountConfigId, addressId);
		const next: AddressFlags = { ...(current.flags ?? {}) };
		for (const [key, value] of Object.entries(patch) as [
			keyof AddressFlags,
			AddressFlags[keyof AddressFlags] | null | undefined,
		][]) {
			if (value === undefined) continue;
			if (value === null) {
				delete next[key];
				continue;
			}
			(next[key] as AddressFlags[keyof AddressFlags]) = value;
		}
		const [row] = await this.db
			.update(addressTable)
			.set({ flags: next as never, updatedAt: Date.now() })
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

	async promoteWellknownByUser(
		accountConfigId: string,
		addressId: string,
		now: number,
	): Promise<AddressItem> {
		const current = await this.getAddress(accountConfigId, addressId);
		const next: AddressFlags = {
			...(current.flags ?? {}),
			wellknown: { value: true, setAt: now, setBy: "user-junk-rescue" },
		};
		const [row] = await this.db
			.update(addressTable)
			.set({ flags: next as never, updatedAt: Date.now() })
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

	async demoteSenderTrust(
		accountConfigId: string,
		addressId: string,
		_now: number,
	): Promise<AddressItem> {
		const current = await this.getAddress(accountConfigId, addressId);
		const { wellknown: _w, vip: _v, ...rest } = current.flags ?? {};
		const [row] = await this.db
			.update(addressTable)
			.set({
				flags: rest as never,
				inboundCount: 0,
				replyCount: 0,
				updatedAt: Date.now(),
			})
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
					inArray(addressTable.addressId, addressIds),
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
					addressSuggestible(),
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

	async createEnvelopeAddress(
		input: CreateEnvelopeAddressInput,
	): Promise<EnvelopeAddressItem> {
		const now = Date.now();
		const envelopeAddressId = deriveEnvelopeAddressId(
			input.messageId,
			input.addressRole,
			input.addressOrder,
		);
		const [row] = await this.db
			.insert(envelopeAddressTable)
			.values({
				envelopeAddressId,
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
		const envelopeAddressId = deriveEnvelopeAddressId(
			input.messageId,
			input.addressRole,
			input.addressOrder,
		);
		const [row] = await this.db
			.insert(envelopeAddressTable)
			.values({
				envelopeAddressId,
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
			return this.getEnvelopeAddress(envelopeAddressId);
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
					inArray(envelopeAddressTable.envelopeAddressId, envelopeAddressId),
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
				inArray(envelopeAddressTable.envelopeAddressId, envelopeAddressIds),
			);
	}
}
