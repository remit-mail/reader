import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import type { AddressFlags } from "@remit/data-ports";
import { createTestDb, randomId, type TestDb } from "../test-db.js";
import { serializeSqliteWrites } from "../tx.js";
import { AddressRepo } from "./i4-address.js";

const FLAG_KEYS = [
	"trusted",
	"blocked",
	"muted",
	"vip",
	"wellknown",
	"junkOnly",
	"autoArchive",
	"unsubscribed",
] as const;

const CONCURRENT_CALLS = 50;

describe("concurrent flag merges on one address", () => {
	let db: TestDb;
	let close: () => Promise<void>;
	let repo: AddressRepo;

	before(async () => {
		({ db, close } = await createTestDb());
		repo = new AddressRepo(serializeSqliteWrites(db) as never);
	});

	after(async () => {
		await close();
	});

	const address = async () => {
		const accountConfigId = randomId();
		return repo.createAddress({
			addressId: randomId(),
			accountConfigId,
			localPart: "sender",
			domain: "example.com",
			normalizedEmail: "sender@example.com",
			normalizedCompound: "sender@example.com:sender",
		});
	};

	test("fifty concurrent merges all survive", async () => {
		const addr = await address();
		const writtenAt = new Map<string, Set<number>>();

		await Promise.all(
			Array.from({ length: CONCURRENT_CALLS }, (_, index) => {
				const key = FLAG_KEYS[index % FLAG_KEYS.length];
				const setAt = 1_000 + index;
				const stamps = writtenAt.get(key) ?? new Set<number>();
				stamps.add(setAt);
				writtenAt.set(key, stamps);
				return repo.mergeFlags(addr.accountConfigId, addr.addressId, {
					[key]: { value: true, setAt },
				});
			}),
		);

		const merged = await repo.getAddress(addr.accountConfigId, addr.addressId);
		const flags: AddressFlags = merged.flags ?? {};
		for (const key of FLAG_KEYS) {
			const flag = flags[key];
			assert.ok(flag, `${key} was lost by a concurrent merge`);
			assert.ok(
				writtenAt.get(key)?.has(flag.setAt),
				`${key} holds a value no merge wrote`,
			);
		}

		await repo.deleteAddress(addr.accountConfigId, addr.addressId);
	});

	test("a concurrent merge does not resurrect a deleted flag", async () => {
		const addr = await address();
		await repo.mergeFlags(addr.accountConfigId, addr.addressId, {
			muted: { value: true, setAt: 1 },
		});

		await Promise.all([
			repo.mergeFlags(addr.accountConfigId, addr.addressId, { muted: null }),
			repo.mergeFlags(addr.accountConfigId, addr.addressId, {
				vip: { value: true, setAt: 2 },
			}),
		]);

		const merged = await repo.getAddress(addr.accountConfigId, addr.addressId);
		assert.equal(merged.flags?.muted, undefined, "muted must stay deleted");
		assert.equal(merged.flags?.vip?.value, true, "vip must survive the delete");

		await repo.deleteAddress(addr.accountConfigId, addr.addressId);
	});
});
