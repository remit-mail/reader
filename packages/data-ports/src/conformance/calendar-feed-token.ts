import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { deriveCalendarFeedTokenId } from "../id.js";
import type { ICalendarFeedTokenRepository } from "../interfaces/calendar-feed-token.js";
import type { RepositoryConformanceHarness } from "./harness.js";

const hashOf = (label: string): string => label.padEnd(64, "0");

export function calendarFeedTokenRepositoryConformance(
	harness: RepositoryConformanceHarness<ICalendarFeedTokenRepository>,
): void {
	describe("ICalendarFeedTokenRepository conformance", () => {
		let repo: ICalendarFeedTokenRepository;

		before(async () => {
			repo = await harness.createRepository();
		});

		after(() => harness.teardown());

		test("put derives the id from the calendar and starts unrotated", async () => {
			const accountConfigId = harness.makeId();
			const calendarId = harness.makeId();

			const minted = await repo.put({
				accountConfigId,
				calendarId,
				tokenHash: hashOf("a"),
			});

			assert.equal(minted.feedTokenId, deriveCalendarFeedTokenId(calendarId));
			assert.equal(minted.calendarId, calendarId);
			assert.equal(minted.tokenHash, hashOf("a"));
			assert.equal(minted.rotatedAt, 0);
			assert.ok(minted.createdAt > 0);
		});

		test("a second put rotates the one address rather than adding another", async () => {
			const accountConfigId = harness.makeId();
			const calendarId = harness.makeId();

			const minted = await repo.put({
				accountConfigId,
				calendarId,
				tokenHash: hashOf("b"),
			});
			const rotated = await repo.put({
				accountConfigId,
				calendarId,
				tokenHash: hashOf("c"),
			});

			assert.equal(rotated.feedTokenId, minted.feedTokenId);
			assert.equal(rotated.tokenHash, hashOf("c"));
			assert.equal(
				rotated.createdAt,
				minted.createdAt,
				"the feed is the same feed under a new secret",
			);
			assert.ok(
				rotated.rotatedAt > 0,
				"a replacement is distinguishable from a first mint",
			);
			assert.equal(
				await repo.findByTokenHash(hashOf("b")),
				null,
				"the address that was rotated away no longer resolves",
			);
			assert.equal(
				(await repo.findByTokenHash(hashOf("c")))?.calendarId,
				calendarId,
			);
		});

		test("findByCalendar answers only for the account config that owns it", async () => {
			const accountConfigId = harness.makeId();
			const stranger = harness.makeId();
			const calendarId = harness.makeId();
			await repo.put({
				accountConfigId,
				calendarId,
				tokenHash: hashOf("d"),
			});

			assert.equal(
				(await repo.findByCalendar(accountConfigId, calendarId))?.tokenHash,
				hashOf("d"),
			);
			assert.equal(await repo.findByCalendar(stranger, calendarId), null);
			assert.equal(
				await repo.findByCalendar(accountConfigId, harness.makeId()),
				null,
			);
		});

		test("findByTokenHash is unscoped, and names the owner it found", async () => {
			const accountConfigId = harness.makeId();
			const calendarId = harness.makeId();
			await repo.put({
				accountConfigId,
				calendarId,
				tokenHash: hashOf("e"),
			});

			const found = await repo.findByTokenHash(hashOf("e"));

			assert.equal(found?.accountConfigId, accountConfigId);
			assert.equal(found?.calendarId, calendarId);
			assert.equal(await repo.findByTokenHash(hashOf("nothing")), null);
		});

		test("delete stops the address resolving", async () => {
			const accountConfigId = harness.makeId();
			const calendarId = harness.makeId();
			await repo.put({
				accountConfigId,
				calendarId,
				tokenHash: hashOf("f"),
			});

			await repo.delete(accountConfigId, calendarId);

			assert.equal(await repo.findByTokenHash(hashOf("f")), null);
			assert.equal(
				await repo.findByCalendar(accountConfigId, calendarId),
				null,
			);
		});

		test("delete leaves another account config's address alone", async () => {
			const accountConfigId = harness.makeId();
			const stranger = harness.makeId();
			const calendarId = harness.makeId();
			await repo.put({
				accountConfigId,
				calendarId,
				tokenHash: hashOf("g"),
			});

			await repo.delete(stranger, calendarId);

			assert.equal(
				(await repo.findByTokenHash(hashOf("g")))?.calendarId,
				calendarId,
			);
		});
	});
}
