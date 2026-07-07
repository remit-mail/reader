import assert from "node:assert";
import { randomUUID } from "node:crypto";
import { after, before, describe, test } from "node:test";
import { envelopeAddressId } from "../id.js";
import { createTestDb, randomId, type TestDb } from "../test-db.js";
import { AddressRepo } from "./i4-address.js";

function makeAddressInput(accountConfigId: string, email = "test@example.com") {
	const [localPart, domain] = email.split("@");
	return {
		addressId: randomId(),
		accountConfigId,
		localPart,
		domain,
		normalizedEmail: email.toLowerCase(),
		normalizedCompound: `${email.toLowerCase()}:${localPart}`,
	};
}

describe("AddressRepo", () => {
	let db: TestDb;
	let close: () => Promise<void>;
	let repo: AddressRepo;

	before(async () => {
		({ db, close } = await createTestDb());
		repo = new AddressRepo(db as never);
	});

	after(async () => {
		await close();
	});

	test("createAddress and getAddress", async () => {
		const accountConfigId = randomId();
		const input = makeAddressInput(accountConfigId);
		const addr = await repo.createAddress(input);

		assert.equal(addr.addressId, input.addressId);
		assert.equal(addr.normalizedEmail, "test@example.com");
		assert.deepEqual(addr.flags, {});
		assert.equal(addr.inboundCount, 0);

		const fetched = await repo.getAddress(accountConfigId, addr.addressId);
		assert.equal(fetched.addressId, addr.addressId);

		await repo.deleteAddress(accountConfigId, addr.addressId);
	});

	test("upsertAddress is idempotent", async () => {
		const input = makeAddressInput(randomId());
		const first = await repo.upsertAddress(input);
		const second = await repo.upsertAddress(input);
		assert.equal(first.addressId, second.addressId);

		await repo.deleteAddress(input.accountConfigId, input.addressId);
	});

	test("batchGet missing keys returns only found items", async () => {
		const addr = await repo.createAddress(makeAddressInput(randomId()));
		const results = await repo.getAddress(addr.accountConfigId, [
			addr.addressId,
			randomId(),
		]);
		assert.equal(results.length, 1);
		assert.equal(results[0].addressId, addr.addressId);

		await repo.deleteAddress(addr.accountConfigId, addr.addressId);
	});

	test("batchGet empty array returns []", async () => {
		const results = await repo.getAddress(randomId(), []);
		assert.deepEqual(results, []);
	});

	test("mergeFlags updates flags", async () => {
		const addr = await repo.createAddress(makeAddressInput(randomId()));
		const updated = await repo.mergeFlags(
			addr.accountConfigId,
			addr.addressId,
			{
				trusted: { value: true, setAt: Date.now() },
			},
		);
		assert.equal(updated.flags?.trusted?.value, true);

		await repo.deleteAddress(addr.accountConfigId, addr.addressId);
	});

	test("incrementInboundCount atomically increments", async () => {
		const addr = await repo.createAddress(makeAddressInput(randomId()));
		const now = Date.now();
		await repo.incrementInboundCount(addr.accountConfigId, addr.addressId, now);

		const updated = await repo.getAddress(addr.accountConfigId, addr.addressId);
		assert.equal(updated.inboundCount, 1);

		await repo.deleteAddress(addr.accountConfigId, addr.addressId);
	});

	test("createEnvelopeAddress and getEnvelopeAddress", async () => {
		const messageId = randomUUID();
		const addressId = randomUUID();
		const envId = envelopeAddressId(messageId, "from", 0);

		const addr = await repo.createAddress({
			...makeAddressInput(randomId()),
			addressId,
		});

		const ea = await repo.createEnvelopeAddress({
			envelopeAddressId: envId,
			messageId,
			addressId,
			normalizedEmail: "test@example.com",
			addressRole: "from",
			addressOrder: 0,
		});

		assert.equal(ea.envelopeAddressId, envId);
		assert.equal(ea.messageId, messageId);
		assert.equal(ea.addressRole, "from");

		const fetched = await repo.getEnvelopeAddress(envId);
		assert.equal(fetched.envelopeAddressId, envId);

		await repo.deleteEnvelopeAddress(envId);
		await repo.deleteAddress(addr.accountConfigId, addr.addressId);
	});

	test("upsertEnvelopeAddress is idempotent", async () => {
		const messageId = randomUUID();
		const input = {
			envelopeAddressId: envelopeAddressId(messageId, "to", 1),
			messageId,
			addressId: randomUUID(),
			normalizedEmail: "x@example.com",
			addressRole: "to" as const,
			addressOrder: 1,
		};
		const first = await repo.upsertEnvelopeAddress(input);
		const second = await repo.upsertEnvelopeAddress(input);
		assert.equal(first.envelopeAddressId, second.envelopeAddressId);

		await repo.deleteEnvelopeAddress(input.envelopeAddressId);
	});

	test("deleteManyEnvelopeAddresses removes in batch", async () => {
		const messageId = randomUUID();
		const ea1 = {
			envelopeAddressId: envelopeAddressId(messageId, "from", 0),
			messageId,
			addressId: randomUUID(),
			normalizedEmail: "a@x.com",
			addressRole: "from" as const,
			addressOrder: 0,
		};
		const ea2 = {
			...ea1,
			envelopeAddressId: envelopeAddressId(messageId, "to", 1),
			addressRole: "to" as const,
			addressOrder: 1,
		};

		await repo.createEnvelopeAddress(ea1);
		await repo.createEnvelopeAddress(ea2);

		await repo.deleteManyEnvelopeAddresses([
			ea1.envelopeAddressId,
			ea2.envelopeAddressId,
		]);

		const results = await repo.getEnvelopeAddress([
			ea1.envelopeAddressId,
			ea2.envelopeAddressId,
		]);
		assert.equal(results.length, 0);
	});

	test("listByAccountConfig paginates without dupes, gaps, or non-termination", async () => {
		const accountConfigId = randomId();
		const created: string[] = [];
		for (const c of ["a", "b", "c", "d", "e"]) {
			const addr = await repo.createAddress(
				makeAddressInput(accountConfigId, `${c}@x.com`),
			);
			created.push(addr.addressId);
		}

		const seen: string[] = [];
		let cursor: string | undefined;
		let pages = 0;
		do {
			const page = await repo.listByAccountConfig({
				accountConfigId,
				limit: 2,
				cursor,
			});
			seen.push(...page.items.map((a) => a.addressId));
			cursor = page.continuationToken;
			pages++;
			assert.ok(pages < 10, "pagination must terminate");
		} while (cursor);

		assert.equal(seen.length, 5, "every row returned exactly once");
		assert.equal(new Set(seen).size, 5, "no duplicates across pages");
		assert.deepEqual([...seen].sort(), [...created].sort(), "no gaps");

		await repo.deleteManyAddresses(accountConfigId, created);
	});

	test("cross-tenant: getAddress refuses a foreign accountConfig", async () => {
		const addr = await repo.createAddress(makeAddressInput(randomId()));
		const other = randomId();

		await assert.rejects(
			() => repo.getAddress(other, addr.addressId),
			/Address not found/,
		);
		assert.deepEqual(await repo.getAddress(other, [addr.addressId]), []);
		const owned = await repo.getAddress(addr.accountConfigId, [addr.addressId]);
		assert.equal(owned.length, 1);

		await repo.deleteAddress(addr.accountConfigId, addr.addressId);
	});

	test("cross-tenant: updateAddress refuses a foreign accountConfig and leaves the row unchanged", async () => {
		const addr = await repo.createAddress(makeAddressInput(randomId()));
		const other = randomId();

		await assert.rejects(
			() => repo.updateAddress(other, addr.addressId, { displayName: "X" }),
			/Address not found/,
		);
		const still = await repo.getAddress(addr.accountConfigId, addr.addressId);
		assert.equal(still.displayName, undefined);

		await repo.deleteAddress(addr.accountConfigId, addr.addressId);
	});

	test("cross-tenant: mergeFlags refuses a foreign accountConfig and leaves the row unchanged", async () => {
		const addr = await repo.createAddress(makeAddressInput(randomId()));
		const other = randomId();

		await assert.rejects(
			() =>
				repo.mergeFlags(other, addr.addressId, {
					trusted: { value: true, setAt: Date.now() },
				}),
			/Address not found/,
		);
		const still = await repo.getAddress(addr.accountConfigId, addr.addressId);
		assert.deepEqual(still.flags, {});

		await repo.deleteAddress(addr.accountConfigId, addr.addressId);
	});

	test("cross-tenant: promoteWellknownByUser refuses a foreign accountConfig and leaves the row unchanged", async () => {
		const addr = await repo.createAddress(makeAddressInput(randomId()));
		const other = randomId();

		await assert.rejects(
			() => repo.promoteWellknownByUser(other, addr.addressId, Date.now()),
			/Address not found/,
		);
		const still = await repo.getAddress(addr.accountConfigId, addr.addressId);
		assert.equal(still.flags?.wellknown, undefined);

		await repo.deleteAddress(addr.accountConfigId, addr.addressId);
	});

	test("cross-tenant: demoteSenderTrust refuses a foreign accountConfig and leaves the row unchanged", async () => {
		const addr = await repo.createAddress(makeAddressInput(randomId()));
		await repo.incrementInboundCount(
			addr.accountConfigId,
			addr.addressId,
			Date.now(),
		);
		const other = randomId();

		await assert.rejects(
			() => repo.demoteSenderTrust(other, addr.addressId, Date.now()),
			/Address not found/,
		);
		const still = await repo.getAddress(addr.accountConfigId, addr.addressId);
		assert.equal(still.inboundCount, 1);

		await repo.deleteAddress(addr.accountConfigId, addr.addressId);
	});

	test("cross-tenant: incrementInboundCount refuses a foreign accountConfig and leaves the row unchanged", async () => {
		const addr = await repo.createAddress(makeAddressInput(randomId()));
		const other = randomId();

		await assert.rejects(
			() => repo.incrementInboundCount(other, addr.addressId, Date.now()),
			/Address not found/,
		);
		const still = await repo.getAddress(addr.accountConfigId, addr.addressId);
		assert.equal(still.inboundCount, 0);

		await repo.deleteAddress(addr.accountConfigId, addr.addressId);
	});

	test("cross-tenant: incrementReplyCount refuses a foreign accountConfig and leaves the row unchanged", async () => {
		const addr = await repo.createAddress(makeAddressInput(randomId()));
		const other = randomId();

		await assert.rejects(
			() => repo.incrementReplyCount(other, addr.addressId, Date.now()),
			/Address not found/,
		);
		const still = await repo.getAddress(addr.accountConfigId, addr.addressId);
		assert.equal(still.replyCount, 0);

		await repo.deleteAddress(addr.accountConfigId, addr.addressId);
	});

	test("cross-tenant: incrementOutboundCount is a no-op for a foreign accountConfig", async () => {
		const addr = await repo.createAddress(makeAddressInput(randomId()));
		const other = randomId();

		await repo.incrementOutboundCount(other, addr.addressId, Date.now());
		const still = await repo.getAddress(addr.accountConfigId, addr.addressId);
		assert.equal(still.outboundCount, 0);

		await repo.deleteAddress(addr.accountConfigId, addr.addressId);
	});

	test("cross-tenant: deleteAddress is a no-op for a foreign accountConfig", async () => {
		const addr = await repo.createAddress(makeAddressInput(randomId()));
		const other = randomId();

		await repo.deleteAddress(other, addr.addressId);
		const still = await repo.getAddress(addr.accountConfigId, addr.addressId);
		assert.equal(still.addressId, addr.addressId);

		await repo.deleteAddress(addr.accountConfigId, addr.addressId);
	});

	test("cross-tenant: deleteManyAddresses only removes ids owned by the tenant", async () => {
		const configA = randomId();
		const configB = randomId();
		const a = await repo.createAddress(makeAddressInput(configA, "a@x.com"));
		const b = await repo.createAddress(makeAddressInput(configB, "b@x.com"));

		await repo.deleteManyAddresses(configA, [a.addressId, b.addressId]);

		await assert.rejects(
			() => repo.getAddress(configA, a.addressId),
			/Address not found/,
		);
		const survived = await repo.getAddress(configB, b.addressId);
		assert.equal(survived.addressId, b.addressId);

		await repo.deleteAddress(configB, b.addressId);
	});
});
