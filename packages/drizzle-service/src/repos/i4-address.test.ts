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

	test("three inbound messages promote a person-shaped sender to wellknown", async () => {
		const addr = await repo.createAddress(makeAddressInput(randomId()));
		const now = Date.now();

		for (let i = 0; i < 3; i++) {
			await repo.incrementInboundCount(
				addr.accountConfigId,
				addr.addressId,
				now,
				false,
			);
		}

		const updated = await repo.getAddress(addr.accountConfigId, addr.addressId);
		assert.equal(updated.flags?.wellknown?.value, true);

		await repo.deleteAddress(addr.accountConfigId, addr.addressId);
	});

	test("a bulk sender never reaches wellknown on inbound volume alone", async () => {
		const addr = await repo.createAddress(makeAddressInput(randomId()));
		const now = Date.now();

		for (let i = 0; i < 5; i++) {
			await repo.incrementInboundCount(
				addr.accountConfigId,
				addr.addressId,
				now,
				true,
			);
		}

		const updated = await repo.getAddress(addr.accountConfigId, addr.addressId);
		assert.equal(updated.inboundCount, 5);
		assert.equal(updated.flags?.wellknown, undefined);

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

	test("listByAccountConfig resolves a search by exact email even when the sender has a display name", async () => {
		const accountConfigId = randomId();
		const created = await repo.createAddress({
			...makeAddressInput(accountConfigId, "support@npmjs.com"),
			displayName: "npm support",
			// How message-sync writes it: display name first, then the email.
			normalizedCompound: "npm support support@npmjs.com",
		});

		const byEmail = await repo.listByAccountConfig({
			accountConfigId,
			search: "support@npmjs.com",
		});
		assert.deepEqual(
			byEmail.items.map((a) => a.addressId),
			[created.addressId],
			"an exact-address lookup must resolve the row",
		);

		const byDisplayName = await repo.listByAccountConfig({
			accountConfigId,
			search: "npm",
		});
		assert.deepEqual(
			byDisplayName.items.map((a) => a.addressId),
			[created.addressId],
			"display-name search keeps working",
		);

		await repo.deleteManyAddresses(accountConfigId, [created.addressId]);
	});

	test("listByAccountConfig matches any word of the display name, the local part and the domain (#704)", async () => {
		const accountConfigId = randomId();
		const created = await repo.createAddress({
			...makeAddressInput(accountConfigId, "amsterdam@pocahondas.nl"),
			displayName: "Pocahondas locatie amsterdam",
			normalizedCompound:
				"pocahondas locatie amsterdam amsterdam@pocahondas.nl",
		});

		for (const term of [
			"po",
			"pocahondas",
			"locatie",
			"amsterdam",
			"pocahondas.nl",
			"@pocahondas.nl",
			"amsterdam@pocahondas.nl",
		]) {
			const found = await repo.listByAccountConfig({
				accountConfigId,
				search: term,
			});
			assert.deepEqual(
				found.items.map((a) => a.addressId),
				[created.addressId],
				`"${term}" must resolve the address`,
			);
		}

		await repo.deleteManyAddresses(accountConfigId, [created.addressId]);
	});

	test("listByAccountConfig finds a display name whose first letter is not ASCII", async () => {
		const accountConfigId = randomId();
		// Written the way message sync writes it: the compound folded in JavaScript.
		const names = [
			["Özcan Bakker", "o.bakker@kliniek.nl", ["Öz", "öz", "özcan", "zcan"]],
			["Émile Zola", "emile@zola.test", ["Ém", "ém", "émile", "zola"]],
			["Ángela Ruiz", "angela@ruiz.test", ["Án", "án", "ángela", "ngela"]],
		] as const;

		for (const [displayName, email, terms] of names) {
			const created = await repo.createAddress({
				...makeAddressInput(accountConfigId, email),
				displayName,
				normalizedCompound: `${displayName.toLowerCase()} ${email}`,
			});

			for (const term of terms) {
				const found = await repo.listByAccountConfig({
					accountConfigId,
					search: term,
				});
				assert.deepEqual(
					found.items.map((a) => a.addressId),
					[created.addressId],
					`"${term}" must resolve ${displayName}`,
				);
			}

			await repo.deleteManyAddresses(accountConfigId, [created.addressId]);
		}
	});

	test("updateAddress keeps the compound findable when a name is not ASCII", async () => {
		const accountConfigId = randomId();
		const created = await repo.createAddress(
			makeAddressInput(accountConfigId, "o.bakker@kliniek.nl"),
		);

		await repo.updateAddress(accountConfigId, created.addressId, {
			displayName: "Özcan Bakker",
		});

		const found = await repo.listByAccountConfig({
			accountConfigId,
			search: "Öz",
		});
		assert.deepEqual(
			found.items.map((a) => a.addressId),
			[created.addressId],
		);

		await repo.deleteManyAddresses(accountConfigId, [created.addressId]);
	});

	test("listByAccountConfig offers a two-letter name match ahead of a louder domain match (#704)", async () => {
		const accountConfigId = randomId();
		const colin = await repo.createAddress({
			...makeAddressInput(accountConfigId, "colin@personal.com"),
			displayName: "Colin Baker",
			inboundCount: 4,
		});
		const newsletter = await repo.createAddress({
			...makeAddressInput(accountConfigId, "info@acme.com"),
			displayName: "Acme Newsletter",
			inboundCount: 500,
		});

		const byInitials = await repo.listByAccountConfig({
			accountConfigId,
			search: "co",
			limit: 1,
		});
		assert.deepEqual(
			byInitials.items.map((a) => a.addressId),
			[colin.addressId],
			"volume must not take the only suggestion slot from a name match",
		);

		const shop = await repo.createAddress({
			...makeAddressInput(accountConfigId, "hello@corner.test"),
			displayName: "Corner Shop",
		});
		const loud = await repo.createAddress({
			...makeAddressInput(accountConfigId, "news@corner.test"),
			displayName: "Loud List",
			inboundCount: 500,
		});
		const byName = await repo.listByAccountConfig({
			accountConfigId,
			search: "corner",
		});
		assert.deepEqual(
			byName.items.map((a) => a.addressId),
			[shop.addressId, loud.addressId],
			"a name match outranks a shared domain",
		);

		await repo.deleteManyAddresses(accountConfigId, [
			colin.addressId,
			newsletter.addressId,
			shop.addressId,
			loud.addressId,
		]);
	});

	test("listByAccountConfig never lets a display name outrank the address a term matches", async () => {
		const accountConfigId = randomId();
		// The 2021 spam row: its display name is the account's own address, its
		// real address is somewhere else entirely.
		const spoof = await repo.createAddress({
			...makeAddressInput(
				accountConfigId,
				"aramirez@secresaludguaviare.gov.co",
			),
			displayName: "matthijs@ischen.nl",
			normalizedCompound:
				"matthijs@ischen.nl aramirez@secresaludguaviare.gov.co",
			inboundCount: 500,
		});
		// The address typed, as a prefix of a domain somebody else registered,
		// louder than the account's own correspondence with itself.
		const lookalike = await repo.createAddress({
			...makeAddressInput(accountConfigId, "matthijs@ischen.nl.evil.example"),
			displayName: "matthijs@ischen.nl",
			normalizedCompound: "matthijs@ischen.nl matthijs@ischen.nl.evil.example",
			inboundCount: 900,
		});
		const own = await repo.createAddress({
			...makeAddressInput(accountConfigId, "matthijs@ischen.nl"),
			displayName: "Matthijs van Henten",
			normalizedCompound: "matthijs van henten matthijs@ischen.nl",
			inboundCount: 3,
		});

		const found = await repo.listByAccountConfig({
			accountConfigId,
			search: "matthijs@ischen.nl",
		});
		assert.deepEqual(
			found.items.map((a) => a.normalizedEmail),
			[own.normalizedEmail, lookalike.normalizedEmail, spoof.normalizedEmail],
			"the address typed must lead every address that only prefixes or claims it",
		);

		const onlySuggestion = await repo.listByAccountConfig({
			accountConfigId,
			search: "matthijs@ischen.nl",
			limit: 1,
		});
		assert.deepEqual(
			onlySuggestion.items.map((a) => a.normalizedEmail),
			[own.normalizedEmail],
			"a single suggestion slot goes to the address that matches whole",
		);

		await repo.deleteManyAddresses(accountConfigId, [
			spoof.addressId,
			lookalike.addressId,
			own.addressId,
		]);
	});

	test("listByAccountConfig keeps a leading display-name match above a domain that only contains the term", async () => {
		const accountConfigId = randomId();
		const shop = await repo.createAddress({
			...makeAddressInput(accountConfigId, "hello@other.test"),
			displayName: "Corner Shop",
			normalizedCompound: "corner shop hello@other.test",
		});
		const leadingDomain = await repo.createAddress({
			...makeAddressInput(
				accountConfigId,
				"sales@cornerstone-analytics.example",
			),
			displayName: "Sales Team",
			normalizedCompound: "sales team sales@cornerstone-analytics.example",
			inboundCount: 200,
		});
		const middleDomain = await repo.createAddress({
			...makeAddressInput(accountConfigId, "news@list-corner.example"),
			displayName: "Loud List",
			normalizedCompound: "loud list news@list-corner.example",
			inboundCount: 500,
		});

		const found = await repo.listByAccountConfig({
			accountConfigId,
			search: "corner",
		});
		assert.deepEqual(
			found.items.map((a) => a.addressId),
			[shop.addressId, leadingDomain.addressId, middleDomain.addressId],
			"the name a reader types stays the first suggestion",
		);

		await repo.deleteManyAddresses(accountConfigId, [
			shop.addressId,
			leadingDomain.addressId,
			middleDomain.addressId,
		]);
	});

	test("listByAccountConfig ranks an address match above a display-name match for the same term", async () => {
		const accountConfigId = randomId();
		const byAddress = await repo.createAddress({
			...makeAddressInput(accountConfigId, "corner@shop.test"),
			displayName: "Zed Ziegler",
			normalizedCompound: "zed ziegler corner@shop.test",
		});
		const byName = await repo.createAddress({
			...makeAddressInput(accountConfigId, "hello@other.test"),
			displayName: "Corner Shop",
			normalizedCompound: "corner shop hello@other.test",
			inboundCount: 500,
		});

		const found = await repo.listByAccountConfig({
			accountConfigId,
			search: "corner",
		});
		assert.deepEqual(
			found.items.map((a) => a.addressId),
			[byAddress.addressId, byName.addressId],
			"the address decides ahead of free text the sender wrote",
		);

		await repo.deleteManyAddresses(accountConfigId, [
			byAddress.addressId,
			byName.addressId,
		]);
	});

	test("listByAccountConfig still resolves a display-name match no address matches", async () => {
		const accountConfigId = randomId();
		const created = await repo.createAddress({
			...makeAddressInput(accountConfigId, "w.baker@kliniek.nl"),
			displayName: "Wendy Baker",
			normalizedCompound: "wendy baker w.baker@kliniek.nl",
		});

		for (const term of ["wendy", "baker", "wendy baker"]) {
			const found = await repo.listByAccountConfig({
				accountConfigId,
				search: term,
			});
			assert.deepEqual(
				found.items.map((a) => a.addressId),
				[created.addressId],
				`"${term}" must resolve the address by its display name`,
			);
		}

		await repo.deleteManyAddresses(accountConfigId, [created.addressId]);
	});

	test("cross-tenant: a search never reaches another account's addresses", async () => {
		const mine = randomId();
		const theirs = randomId();
		const ours = await repo.createAddress({
			...makeAddressInput(mine, "amsterdam@pocahondas.nl"),
			displayName: "Pocahondas locatie amsterdam",
		});
		const foreign = await repo.createAddress({
			...makeAddressInput(theirs, "amsterdam@pocahondas.nl"),
			displayName: "Pocahondas locatie amsterdam",
		});

		for (const term of ["po", "amsterdam", "pocahondas.nl"]) {
			const found = await repo.listByAccountConfig({
				accountConfigId: mine,
				search: term,
			});
			assert.deepEqual(
				found.items.map((a) => a.addressId),
				[ours.addressId],
				`"${term}" must stay inside the caller's account`,
			);
		}

		await repo.deleteManyAddresses(mine, [ours.addressId]);
		await repo.deleteManyAddresses(theirs, [foreign.addressId]);
	});

	test("listByAccountConfig puts a match at the start of a name above one in the middle", async () => {
		const accountConfigId = randomId();
		const leading = await repo.createAddress({
			...makeAddressInput(accountConfigId, "amsterdam@pocahondas.nl"),
			displayName: "Pocahondas locatie amsterdam",
		});
		const middle = await repo.createAddress({
			...makeAddressInput(accountConfigId, "hello@example.test"),
			displayName: "Studio Pocahondas",
			inboundCount: 500,
		});

		const found = await repo.listByAccountConfig({
			accountConfigId,
			search: "po",
		});
		assert.deepEqual(
			found.items.map((a) => a.addressId),
			[leading.addressId, middle.addressId],
			"a mid-name match is returned, but below the one the term starts",
		);

		await repo.deleteManyAddresses(accountConfigId, [
			leading.addressId,
			middle.addressId,
		]);
	});

	test("listByAccountConfig leads a tier with the account's own VIP", async () => {
		const accountConfigId = randomId();
		const vip = await repo.createAddress({
			...makeAddressInput(accountConfigId, "one@vips.test"),
			displayName: "Sales Alice",
			flags: { vip: { value: true, setAt: 1 } },
		});
		const trusted = await repo.createAddress({
			...makeAddressInput(accountConfigId, "two@vips.test"),
			displayName: "Sales Bob",
			flags: { trusted: { value: true, setAt: 1 } },
			inboundCount: 40,
		});
		const stranger = await repo.createAddress({
			...makeAddressInput(accountConfigId, "three@vips.test"),
			displayName: "Sales Carol",
			inboundCount: 900,
		});

		const found = await repo.listByAccountConfig({
			accountConfigId,
			search: "sales",
		});
		assert.deepEqual(
			found.items.map((a) => a.addressId),
			[vip.addressId, trusted.addressId, stranger.addressId],
			"standing decides ahead of volume",
		);

		await repo.deleteManyAddresses(accountConfigId, [
			vip.addressId,
			trusted.addressId,
			stranger.addressId,
		]);
	});

	test("listByAccountConfig finds an address whose display name arrived after the first sighting", async () => {
		const accountConfigId = randomId();
		// How message-sync writes a first sighting with no display name, then a
		// later one that carries it.
		const nameless = {
			...makeAddressInput(accountConfigId, "amsterdam@pocahondas.nl"),
			displayName: "",
			normalizedCompound: "amsterdam@pocahondas.nl",
		};
		await repo.upsertAddress(nameless);
		const created = await repo.upsertAddress({
			...nameless,
			displayName: "Pocahondas locatie amsterdam",
			normalizedCompound:
				"pocahondas locatie amsterdam amsterdam@pocahondas.nl",
		});
		assert.equal(created.displayName, "Pocahondas locatie amsterdam");

		for (const term of ["po", "locatie", "pocahondas"]) {
			const found = await repo.listByAccountConfig({
				accountConfigId,
				search: term,
			});
			assert.deepEqual(
				found.items.map((a) => a.addressId),
				[created.addressId],
				`"${term}" must resolve the address`,
			);
		}

		await repo.deleteManyAddresses(accountConfigId, [created.addressId]);
	});

	test("upsertAddress keeps a known display name when a later sighting carries none", async () => {
		const accountConfigId = randomId();
		const named = {
			...makeAddressInput(accountConfigId, "amsterdam@pocahondas.nl"),
			displayName: "Pocahondas locatie amsterdam",
			normalizedCompound:
				"pocahondas locatie amsterdam amsterdam@pocahondas.nl",
		};
		await repo.upsertAddress(named);
		const after = await repo.upsertAddress({
			...named,
			displayName: "",
			normalizedCompound: "amsterdam@pocahondas.nl",
		});

		assert.equal(after.displayName, "Pocahondas locatie amsterdam");
		assert.equal(
			after.normalizedCompound,
			"pocahondas locatie amsterdam amsterdam@pocahondas.nl",
		);
		const found = await repo.listByAccountConfig({
			accountConfigId,
			search: "locatie",
		});
		assert.deepEqual(
			found.items.map((a) => a.addressId),
			[named.addressId],
		);

		await repo.deleteManyAddresses(accountConfigId, [named.addressId]);
	});

	test("listByAccountConfig ranks an address the account writes to above an alphabetically earlier stranger (#704)", async () => {
		const accountConfigId = randomId();
		const stranger = await repo.createAddress({
			...makeAddressInput(accountConfigId, "aaron@example.com"),
			displayName: "Aaron Stranger",
			normalizedCompound: "aaron stranger aaron@example.com",
		});
		const frequent = await repo.createAddress({
			...makeAddressInput(accountConfigId, "zoe@example.com"),
			displayName: "Zoe Frequent",
			normalizedCompound: "zoe frequent zoe@example.com",
		});
		// Written to, never heard back from — the compose field's most useful
		// suggestion and the one a received-mail-only score would bury.
		const now = Date.now();
		await repo.incrementOutboundCount(accountConfigId, frequent.addressId, now);
		await repo.incrementOutboundCount(accountConfigId, frequent.addressId, now);

		const ranked = await repo.listByAccountConfig({
			accountConfigId,
			search: "example.com",
		});
		assert.deepEqual(
			ranked.items.map((a) => a.normalizedEmail),
			["zoe@example.com", "aaron@example.com"],
			"correspondence outranks the alphabet",
		);

		const cut = await repo.listByAccountConfig({
			accountConfigId,
			search: "example.com",
			limit: 1,
		});
		assert.deepEqual(
			cut.items.map((a) => a.normalizedEmail),
			["zoe@example.com"],
			"a short suggestion list keeps the address worth suggesting",
		);

		await repo.deleteManyAddresses(accountConfigId, [
			stranger.addressId,
			frequent.addressId,
		]);
	});

	test("listByAccountConfig pages a ranked search without dupes or gaps", async () => {
		const accountConfigId = randomId();
		const created: string[] = [];
		for (const [index, name] of ["a", "b", "c", "d", "e"].entries()) {
			const addr = await repo.createAddress({
				...makeAddressInput(accountConfigId, `${name}@ranked.test`),
				displayName: name,
				normalizedCompound: `${name} ${name}@ranked.test`,
				inboundCount: index % 2,
			});
			created.push(addr.addressId);
		}

		const seen: string[] = [];
		let cursor: string | undefined;
		let pages = 0;
		do {
			const page = await repo.listByAccountConfig({
				accountConfigId,
				search: "ranked.test",
				limit: 2,
				cursor,
			});
			seen.push(...page.items.map((a) => a.addressId));
			cursor = page.continuationToken;
			pages++;
			assert.ok(pages < 10, "pagination must terminate");
		} while (cursor);

		assert.equal(new Set(seen).size, 5, "every row returned exactly once");
		assert.deepEqual([...seen].sort(), [...created].sort(), "no gaps");

		await repo.deleteManyAddresses(accountConfigId, created);
	});

	test("listByAccountConfig treats LIKE metacharacters in a search term literally", async () => {
		const accountConfigId = randomId();
		const plain = await repo.createAddress(
			makeAddressInput(accountConfigId, "ab@x.com"),
		);
		const literal = await repo.createAddress(
			makeAddressInput(accountConfigId, "a%b_c@x.com"),
		);

		for (const term of ["a_@x.com", "a%x", "a%b_c@y"]) {
			const found = await repo.listByAccountConfig({
				accountConfigId,
				search: term,
			});
			assert.deepEqual(
				found.items.map((a) => a.addressId),
				[],
				`"${term}" must match no wildcard`,
			);
		}

		for (const term of ["a%b", "b_c", "a%b_c@x.com"]) {
			const found = await repo.listByAccountConfig({
				accountConfigId,
				search: term,
			});
			assert.deepEqual(
				found.items.map((a) => a.addressId),
				[literal.addressId],
				`"${term}" must match the metacharacter literally`,
			);
		}

		await repo.deleteManyAddresses(accountConfigId, [
			plain.addressId,
			literal.addressId,
		]);
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

	/**
	 * The write path's half of #822: an address met inside a Junk mailbox is
	 * recorded so the message renders it, and withheld from the suggestion list
	 * until the account meets it anywhere else.
	 */
	describe("addresses met only in Junk (#822)", () => {
		const junkInput = (accountConfigId: string, email: string) => ({
			...makeAddressInput(accountConfigId, email),
			displayName: "Pharma Deals",
			normalizedCompound: `pharma deals ${email}`,
		});

		test("a suggestion list never offers a withheld address", async () => {
			const accountConfigId = randomId();
			const withheld = await repo.upsertJunkAddress(
				junkInput(accountConfigId, "sales@pharma.example"),
			);
			const ordinary = await repo.upsertAddress(
				makeAddressInput(accountConfigId, "colleague@pharma.example"),
			);

			const page = await repo.listByAccountConfig({
				accountConfigId,
				search: "pharma",
			});

			assert.deepEqual(
				page.items.map((a) => a.addressId),
				[ordinary.addressId],
			);

			await repo.deleteManyAddresses(accountConfigId, [
				withheld.addressId,
				ordinary.addressId,
			]);
		});

		/**
		 * The same endpoint resolves one exact sender for the per-sender controls
		 * a message view renders. Withholding that answer would leave every one of
		 * them dead on a spam message.
		 */
		test("an exact address still resolves a withheld row", async () => {
			const accountConfigId = randomId();
			const withheld = await repo.upsertJunkAddress(
				junkInput(accountConfigId, "sales@pharma.example"),
			);

			const page = await repo.listByAccountConfig({
				accountConfigId,
				search: "sales@pharma.example",
			});

			assert.deepEqual(
				page.items.map((a) => a.addressId),
				[withheld.addressId],
			);

			await repo.deleteAddress(accountConfigId, withheld.addressId);
		});

		test("a bare listing never offers a withheld address", async () => {
			const accountConfigId = randomId();
			const withheld = await repo.upsertJunkAddress(
				junkInput(accountConfigId, "sales@pharma.example"),
			);
			const ordinary = await repo.upsertAddress(
				makeAddressInput(accountConfigId, "colleague@pharma.example"),
			);

			const page = await repo.listByAccountConfig({ accountConfigId });

			assert.deepEqual(
				page.items.map((a) => a.addressId),
				[ordinary.addressId],
			);

			await repo.deleteManyAddresses(accountConfigId, [
				withheld.addressId,
				ordinary.addressId,
			]);
		});

		test("the row is still there to resolve the message that carried it", async () => {
			const accountConfigId = randomId();
			const input = junkInput(accountConfigId, "sales@pharma.example");
			const withheld = await repo.upsertJunkAddress(input);

			const fetched = await repo.getAddress(accountConfigId, input.addressId);
			assert.equal(fetched.normalizedEmail, "sales@pharma.example");
			assert.equal(fetched.flags?.junkOnly?.value, true);

			await repo.deleteAddress(accountConfigId, withheld.addressId);
		});

		test("one sighting outside Junk restores it", async () => {
			const accountConfigId = randomId();
			const input = junkInput(accountConfigId, "misfiled@pharma.example");
			await repo.upsertJunkAddress(input);

			const harvested = await repo.upsertAddress(input);

			assert.equal(harvested.flags?.junkOnly, undefined);
			const page = await repo.listByAccountConfig({
				accountConfigId,
				search: "misfiled",
			});
			assert.deepEqual(
				page.items.map((a) => a.addressId),
				[input.addressId],
			);

			await repo.deleteAddress(accountConfigId, input.addressId);
		});

		test("a sighting in Junk leaves an address the account knows alone", async () => {
			const accountConfigId = randomId();
			const known = makeAddressInput(accountConfigId, "friend@pharma.example");
			await repo.upsertAddress({ ...known, displayName: "Real Friend" });

			const after = await repo.upsertJunkAddress({
				...known,
				displayName: "Pharma Deals",
				normalizedCompound: "pharma deals friend@pharma.example",
			});

			assert.equal(after.displayName, "Real Friend");
			assert.equal(after.flags?.junkOnly, undefined);

			await repo.deleteAddress(accountConfigId, known.addressId);
		});

		test("clearing the mark keeps the rest of the flags", async () => {
			const accountConfigId = randomId();
			const input = junkInput(accountConfigId, "noisy@pharma.example");
			await repo.upsertJunkAddress(input);
			await repo.mergeFlags(accountConfigId, input.addressId, {
				muted: { value: true, setAt: 7 },
			});

			const harvested = await repo.upsertAddress(input);

			assert.equal(harvested.flags?.junkOnly, undefined);
			assert.equal(harvested.flags?.muted?.value, true);

			await repo.deleteAddress(accountConfigId, input.addressId);
		});
	});

	describe("continuation token rejection (#172)", () => {
		for (const [label, token] of [
			["an unparseable", "not-a-cursor"],
			["a bare number", Buffer.from("123").toString("base64url")],
			["a JSON array", Buffer.from("[1,2]").toString("base64url")],
			[
				"a token without a ranking key",
				Buffer.from(
					JSON.stringify({ normalizedCompound: "a", addressId: "b" }),
				).toString("base64url"),
			],
		] as const) {
			test(`${label} cursor is rejected as a 400`, async () => {
				await assert.rejects(
					() =>
						repo.listByAccountConfig({
							accountConfigId: randomId(),
							cursor: token,
						}),
					(error: unknown) => {
						assert.equal((error as { statusCode?: number }).statusCode, 400);
						assert.equal((error as Error).name, "BadRequestError");
						return true;
					},
				);
			});
		}
	});
});
