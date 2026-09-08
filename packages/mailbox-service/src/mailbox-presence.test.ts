import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { IMailboxRepository } from "@remit/data-ports";
import { NotFoundError } from "@remit/data-ports/errors";
import { MailboxSyncStatus } from "@remit/domain-enums";
import {
	isFolderMutationInFlight,
	isMailboxMutationInFlight,
} from "./mailbox-presence.js";

const reader = (
	get: IMailboxRepository["get"],
): Pick<IMailboxRepository, "get"> => ({ get });

describe("isFolderMutationInFlight", () => {
	for (const [syncStatus, inFlight] of [
		[MailboxSyncStatus.synced, false],
		[MailboxSyncStatus.pending, true],
		[MailboxSyncStatus.deleting, true],
		[MailboxSyncStatus.failed, false],
	] as const) {
		it(`${syncStatus} is ${inFlight ? "" : "not "}a mutation in flight`, () => {
			assert.equal(isFolderMutationInFlight({ syncStatus }), inFlight);
		});
	}

	it("does not read failed as a folder to leave alone", () => {
		// `failed` means the folder exists at `fullPath` and the last rename or
		// delete intent did not land — so it holds the user's mail and syncing it
		// is right. D7 upholds that by leaving no row at all for a create the
		// server refused. Reading it as in-flight would stop syncing a live folder
		// permanently and silently.
		assert.equal(
			isFolderMutationInFlight({ syncStatus: MailboxSyncStatus.failed }),
			false,
		);
	});
});

describe("isMailboxMutationInFlight", () => {
	it("reads the row it is given", async () => {
		const service = reader((async () => ({
			syncStatus: MailboxSyncStatus.deleting,
		})) as unknown as IMailboxRepository["get"]);

		assert.equal(await isMailboxMutationInFlight(service, "acc", "mbx"), true);
	});

	it("treats an absent row as in flight", async () => {
		// The row's absence does not decide it at either end: on the way out the
		// row is removed only after the IMAP folder is, and on the way in the row
		// exists before the folder does.
		const service = reader((async () => {
			throw new NotFoundError("Mailbox not found: mbx");
		}) as unknown as IMailboxRepository["get"]);

		assert.equal(await isMailboxMutationInFlight(service, "acc", "mbx"), true);
	});

	it("rethrows a read that cannot answer", async () => {
		// The caller uses this to classify a failure in hand; a read that fails
		// for its own reasons must not be reported as "the folder is busy".
		const service = reader((async () => {
			throw new Error("connection reset by peer");
		}) as unknown as IMailboxRepository["get"]);

		await assert.rejects(
			isMailboxMutationInFlight(service, "acc", "mbx"),
			/connection reset by peer/,
		);
	});
});
