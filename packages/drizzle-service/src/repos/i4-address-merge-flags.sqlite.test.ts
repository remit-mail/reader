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

	test("marking a blocked sender never-spam drops the block", async () => {
		const addr = await address();
		await repo.mergeFlags(addr.accountConfigId, addr.addressId, {
			blocked: { value: true, setAt: 1 },
			muted: { value: true, setAt: 1 },
		});

		await repo.mergeFlags(addr.accountConfigId, addr.addressId, {
			neverSpam: { value: true, setAt: 2 },
		});

		const merged = await repo.getAddress(addr.accountConfigId, addr.addressId);
		assert.equal(merged.flags?.neverSpam?.value, true);
		assert.equal(merged.flags?.blocked, undefined);
		assert.equal(
			merged.flags?.muted?.value,
			true,
			"a flag on another axis is untouched",
		);

		await repo.deleteAddress(addr.accountConfigId, addr.addressId);
	});

	test("blocking a never-spam sender drops the grant", async () => {
		const addr = await address();
		await repo.mergeFlags(addr.accountConfigId, addr.addressId, {
			neverSpam: { value: true, setAt: 1 },
		});

		await repo.mergeFlags(addr.accountConfigId, addr.addressId, {
			blocked: { value: true, setAt: 2 },
		});

		const merged = await repo.getAddress(addr.accountConfigId, addr.addressId);
		assert.equal(merged.flags?.blocked?.value, true);
		assert.equal(merged.flags?.neverSpam, undefined);

		await repo.deleteAddress(addr.accountConfigId, addr.addressId);
	});

	test("a never-spam grant turned off leaves a later block alone", async () => {
		const addr = await address();
		await repo.mergeFlags(addr.accountConfigId, addr.addressId, {
			neverSpam: { value: false, setAt: 1 },
		});

		await repo.mergeFlags(addr.accountConfigId, addr.addressId, {
			blocked: { value: true, setAt: 2 },
		});

		const merged = await repo.getAddress(addr.accountConfigId, addr.addressId);
		assert.equal(merged.flags?.blocked?.value, true);
		assert.equal(
			merged.flags?.neverSpam?.value,
			false,
			"an explicit false is not a contradiction and keeps its audit trail",
		);

		await repo.deleteAddress(addr.accountConfigId, addr.addressId);
	});

	// A row written before the invariant existed still carries both. Healing it
	// while patching an unrelated key would revoke a placement instruction the
	// user never touched, so the write leaves it and the read arbitrates.
	test("a patch about another flag leaves a legacy both-set row alone", async () => {
		const accountConfigId = randomId();
		const addr = await repo.createAddress({
			addressId: randomId(),
			accountConfigId,
			localPart: "legacy",
			domain: "example.com",
			normalizedEmail: "legacy@example.com",
			normalizedCompound: "legacy@example.com:legacy",
			flags: {
				blocked: { value: true, setAt: 1 },
				neverSpam: { value: true, setAt: 2 },
			},
		});

		await repo.mergeFlags(addr.accountConfigId, addr.addressId, {
			muted: { value: true, setAt: 3 },
		});

		const merged = await repo.getAddress(addr.accountConfigId, addr.addressId);
		assert.equal(merged.flags?.blocked?.value, true);
		assert.equal(merged.flags?.neverSpam?.value, true);
		assert.equal(merged.flags?.muted?.value, true);

		await repo.deleteAddress(addr.accountConfigId, addr.addressId);
	});

	test("writing either placement flag heals a legacy both-set row", async () => {
		const accountConfigId = randomId();
		const addr = await repo.createAddress({
			addressId: randomId(),
			accountConfigId,
			localPart: "legacy",
			domain: "example.com",
			normalizedEmail: "legacy2@example.com",
			normalizedCompound: "legacy2@example.com:legacy",
			flags: {
				blocked: { value: true, setAt: 1 },
				neverSpam: { value: true, setAt: 2 },
			},
		});

		await repo.mergeFlags(addr.accountConfigId, addr.addressId, {
			neverSpam: { value: true, setAt: 3 },
		});

		const merged = await repo.getAddress(addr.accountConfigId, addr.addressId);
		assert.equal(merged.flags?.neverSpam?.value, true);
		assert.equal(merged.flags?.blocked, undefined);

		await repo.deleteAddress(addr.accountConfigId, addr.addressId);
	});

	test("one patch naming both contradictory flags settles on the block", async () => {
		const addr = await address();
		await repo.mergeFlags(addr.accountConfigId, addr.addressId, {
			blocked: { value: true, setAt: 1 },
			neverSpam: { value: true, setAt: 1 },
		});

		const merged = await repo.getAddress(addr.accountConfigId, addr.addressId);
		assert.equal(merged.flags?.blocked?.value, true);
		assert.equal(merged.flags?.neverSpam, undefined);

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
