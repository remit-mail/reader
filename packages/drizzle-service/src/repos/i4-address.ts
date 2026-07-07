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
import { and, asc, eq, gt, inArray, or, sql } from "drizzle-orm";
import type { Db } from "../db.js";
import { NotFoundError } from "../error.js";
import { envelopeAddressId as deriveEnvelopeAddressId } from "../id.js";
import { decodeToken, resultList } from "../pagination.js";
import { addressTable } from "../schema/i4-address.js";
import { envelopeAddressTable } from "../schema/message-data.js";
import { shouldPromoteWellknown } from "./i4-address-wellknown.js";

type DB = Db<Record<string, unknown>>;

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
				set: {
					displayName: input.displayName ?? sql`${addressTable.displayName}`,
					updatedAt: now,
				},
			})
			.returning();
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
		const updates: Partial<typeof addressTable.$inferInsert> = {
			updatedAt: now,
		};
		if (input.displayName !== undefined)
			updates.displayName = input.displayName;
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
		_isBulk?: boolean,
	): Promise<void> {
		const current = await this.getAddress(accountConfigId, addressId);
		const post = {
			...current,
			inboundCount: (current.inboundCount ?? 0) + 1,
			lastInboundAt: now,
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
		normalizedCompound?: string;
		cursor?: string;
		limit?: number;
	}): Promise<ResultList<AddressItem>> {
		const { accountConfigId, normalizedCompound, cursor, limit = 100 } = input;
		const decoded = cursor ? decodeToken(cursor) : undefined;
		const after = decoded
			? {
					normalizedCompound: decoded.normalizedCompound as string,
					addressId: decoded.addressId as string,
				}
			: undefined;

		const rows = await this.db
			.select()
			.from(addressTable)
			.where(
				and(
					eq(addressTable.accountConfigId, accountConfigId),
					normalizedCompound
						? sql`${addressTable.normalizedCompound} LIKE ${`${normalizedCompound}%`}`
						: undefined,
					after
						? or(
								gt(addressTable.normalizedCompound, after.normalizedCompound),
								and(
									eq(addressTable.normalizedCompound, after.normalizedCompound),
									gt(addressTable.addressId, after.addressId),
								),
							)
						: undefined,
				),
			)
			.orderBy(
				asc(addressTable.normalizedCompound),
				asc(addressTable.addressId),
			)
			.limit(limit + 1);

		const hasMore = rows.length > limit;
		const items = rows.slice(0, limit).map(rowToAddress);
		const lastItem = items[items.length - 1];
		return resultList(
			items,
			limit,
			hasMore && lastItem
				? {
						normalizedCompound: lastItem.normalizedCompound,
						addressId: lastItem.addressId,
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
