import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import type { ISenderSignerStandingRepository } from "../interfaces/sender-signer-standing.js";
import type { RepositoryConformanceHarness } from "./harness.js";

export function senderSignerStandingRepositoryConformance(
	harness: RepositoryConformanceHarness<ISenderSignerStandingRepository>,
): void {
	describe("ISenderSignerStandingRepository conformance", () => {
		let repo: ISenderSignerStandingRepository;

		before(async () => {
			repo = await harness.createRepository();
		});

		after(() => harness.teardown());

		test("the first observation creates the row at a count of one", async () => {
			const accountConfigId = harness.makeId();
			const observedAt = 1_700_000_000_000;

			const standing = await repo.observe({
				accountConfigId,
				senderKey: "example.com",
				signerDomain: "esp.example",
				observedAt,
			});

			assert.equal(standing.messageCount, 1);
			assert.equal(standing.firstSeenAt, observedAt);
			assert.equal(standing.lastSeenAt, observedAt);
			assert.equal(standing.userAffirmedAt, 0);
		});

		test("a repeat observation increments the count", async () => {
			const accountConfigId = harness.makeId();
			const key = {
				accountConfigId,
				senderKey: "example.com",
				signerDomain: "esp.example",
			};

			await repo.observe({ ...key, observedAt: 1_700_000_000_000 });
			const second = await repo.observe({
				...key,
				observedAt: 1_700_000_060_000,
			});

			assert.equal(second.messageCount, 2);
			assert.equal(
				(await repo.get(accountConfigId, key.senderKey, key.signerDomain))
					.messageCount,
				2,
			);
		});

		test("firstSeenAt survives every later observation while lastSeenAt advances", async () => {
			const accountConfigId = harness.makeId();
			const key = {
				accountConfigId,
				senderKey: "news.example.com",
				signerDomain: "unverified",
			};
			const first = 1_700_000_000_000;

			await repo.observe({ ...key, observedAt: first });
			await repo.observe({ ...key, observedAt: first + 60_000 });
			const third = await repo.observe({ ...key, observedAt: first + 120_000 });

			assert.equal(third.messageCount, 3);
			assert.equal(third.firstSeenAt, first);
			assert.equal(third.lastSeenAt, first + 120_000);

			const reread = await repo.get(
				accountConfigId,
				key.senderKey,
				key.signerDomain,
			);
			assert.equal(reread.firstSeenAt, first);
			assert.equal(reread.lastSeenAt, first + 120_000);
		});

		test("a key differing only in signer domain is a separate row", async () => {
			const accountConfigId = harness.makeId();
			const observedAt = 1_700_000_000_000;

			await repo.observe({
				accountConfigId,
				senderKey: "example.com",
				signerDomain: "esp-one.example",
				observedAt,
			});
			const other = await repo.observe({
				accountConfigId,
				senderKey: "example.com",
				signerDomain: "esp-two.example",
				observedAt,
			});

			assert.equal(other.messageCount, 1);
		});

		test("get reports not-found for a key never observed, and does not create it", async () => {
			const accountConfigId = harness.makeId();

			await assert.rejects(
				repo.get(accountConfigId, "stranger.example", "esp.example"),
				(error) => harness.isNotFoundError(error),
			);

			await assert.rejects(
				repo.get(accountConfigId, "stranger.example", "esp.example"),
				(error) => harness.isNotFoundError(error),
			);
		});
	});
}
