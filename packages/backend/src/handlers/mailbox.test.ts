import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import type { MailboxItem } from "@remit/data-ports";
import { MailboxSyncStatus } from "@remit/domain-enums";
import { UnconfirmedTrashMailboxError } from "@remit/mailbox-service";
import type { APIGatewayProxyEvent } from "aws-lambda";
import type { Context } from "openapi-backend";
import { deriveAccountConfigId } from "../auth.js";
import {
	_resetForTest,
	type RemitClient,
	setClient,
} from "../service/data-client.js";
import { excludeDeletingMailboxes, TrashOperations } from "./mailbox.js";

const mailbox = (
	over: Partial<MailboxItem> & { mailboxId: string },
): MailboxItem =>
	({ fullPath: over.mailboxId, ...over }) as unknown as MailboxItem;

describe("excludeDeletingMailboxes", () => {
	it("drops a folder being deleted so it leaves the list before the worker reaps it", () => {
		const items = [
			mailbox({ mailboxId: "inbox", syncStatus: MailboxSyncStatus.synced }),
			mailbox({ mailboxId: "gone", syncStatus: MailboxSyncStatus.deleting }),
			mailbox({ mailboxId: "new", syncStatus: MailboxSyncStatus.pending }),
		];
		assert.deepEqual(
			excludeDeletingMailboxes(items).map((m) => m.mailboxId),
			["inbox", "new"],
		);
	});

	it("keeps a folder whose delete failed and was restored off `deleting`", () => {
		const items = [
			mailbox({ mailboxId: "restored", syncStatus: MailboxSyncStatus.failed }),
		];
		assert.deepEqual(
			excludeDeletingMailboxes(items).map((m) => m.mailboxId),
			["restored"],
		);
	});
});

const SUB = "cognito-sub-887";
const ACCOUNT_ID = "acc-887";

const emptyTrash = TrashOperations.TrashOperations_emptyTrash as unknown as (
	context: Context,
	event: APIGatewayProxyEvent,
) => Promise<{ deletedCount: number }>;

const callEmptyTrash = (
	serviceEmptyTrash: () => Promise<{ deletedCount: number }>,
): Promise<{ deletedCount: number }> => {
	setClient({
		account: {
			get: async () => ({
				accountId: ACCOUNT_ID,
				accountConfigId: deriveAccountConfigId(SUB),
			}),
		},
		messageMove: { emptyTrash: serviceEmptyTrash },
	} as unknown as RemitClient);

	return emptyTrash(
		{ request: { params: { accountId: ACCOUNT_ID } } } as unknown as Context,
		{
			requestContext: { authorizer: { claims: { sub: SUB } } },
		} as unknown as APIGatewayProxyEvent,
	);
};

describe("TrashOperations_emptyTrash", () => {
	afterEach(() => {
		_resetForTest();
	});

	it("reports the service's count rather than one of its own", async () => {
		// The handler resolves no folder and counts no rows: a second read would
		// be free to disagree with the one that actually marked them.
		const response = await callEmptyTrash(async () => ({ deletedCount: 7 }));

		assert.deepEqual(response, { deletedCount: 7 });
	});

	it("lets the service's coded refusal through untouched", async () => {
		await assert.rejects(
			callEmptyTrash(async () => {
				throw new UnconfirmedTrashMailboxError(ACCOUNT_ID);
			}),
			(error: unknown) =>
				error instanceof UnconfirmedTrashMailboxError &&
				error.statusCode === 409 &&
				error.publicApiError?.details?.reason === "unconfirmed",
		);
	});
});
