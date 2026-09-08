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
import { MailboxDetailOperations, TrashOperations } from "./mailbox.js";

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

const deleteMailbox =
	MailboxDetailOperations.MailboxDetailOperations_deleteMailbox as unknown as (
		context: Context,
		event: APIGatewayProxyEvent,
	) => Promise<{ statusCode: number }>;

const folder = (over: Partial<MailboxItem> = {}): MailboxItem =>
	({
		mailboxId: "mbx-1",
		accountId: ACCOUNT_ID,
		fullPath: "Receipts",
		hierarchyDelimiter: "/",
		syncStatus: MailboxSyncStatus.synced,
		...over,
	}) as MailboxItem;

interface DeleteWorld {
	mailbox?: MailboxItem;
	children?: MailboxItem[];
	filters?: { name: string; actionMailboxId: string }[];
	appointments?: Record<string, string>;
}

const callDelete = (
	world: DeleteWorld,
): { run: () => Promise<{ statusCode: number }>; deleted: string[] } => {
	const deleted: string[] = [];
	setClient({
		account: {
			get: async () => ({
				accountId: ACCOUNT_ID,
				accountConfigId: deriveAccountConfigId(SUB),
			}),
		},
		mailbox: {
			get: async () => world.mailbox ?? folder(),
			findByPathPrefix: async () => world.children ?? [],
		},
		filter: {
			listByAccountConfig: async () => world.filters ?? [],
		},
		accountSetting: {
			get: async (_configId: string, name: string) => {
				for (const [role, mailboxId] of Object.entries(
					world.appointments ?? {},
				)) {
					if (name === `FolderRoleAppointment#${ACCOUNT_ID}#${role}`) {
						return { value: { kind: "String", value: mailboxId } };
					}
				}
				return null;
			},
		},
		mailboxQueue: {
			deleteMailbox: async (mailboxId: string) => {
				deleted.push(mailboxId);
			},
		},
	} as unknown as RemitClient);

	return {
		deleted,
		run: () =>
			deleteMailbox(
				{
					request: { params: { accountId: ACCOUNT_ID, mailboxId: "mbx-1" } },
				} as unknown as Context,
				{
					requestContext: { authorizer: { claims: { sub: SUB } } },
				} as unknown as APIGatewayProxyEvent,
			),
	};
};

const refusal = (match: RegExp) => (error: unknown) =>
	(error as { statusCode?: number }).statusCode === 400 &&
	match.test((error as Error).message);

describe("MailboxDetailOperations_deleteMailbox — what it refuses (D4, D16)", () => {
	afterEach(() => {
		_resetForTest();
	});

	it("refuses the inbox", async () => {
		const { run, deleted } = callDelete({
			mailbox: folder({ fullPath: "INBOX" }),
		});

		await assert.rejects(run(), refusal(/inbox can't be deleted/));
		assert.deepEqual(deleted, []);
	});

	it("refuses a folder that has folders inside it", async () => {
		// The server would keep the parent's name as a placeholder and leave the
		// children untouched — an outcome no local row describes.
		const { run, deleted } = callDelete({
			children: [folder({ mailboxId: "mbx-2", fullPath: "Receipts/2026" })],
		});

		await assert.rejects(run(), refusal(/has folders inside it/));
		assert.deepEqual(deleted, []);
	});

	/**
	 * D16. Refusing is what makes the settled-target rule total: a binding is
	 * only created against a settled folder and only removed by the user, so a
	 * mailboxId that names nothing never exists and no reader needs a
	 * missing-target branch.
	 */
	it("refuses a folder a filter moves mail into, naming the filter", async () => {
		const { run, deleted } = callDelete({
			filters: [{ name: "Invoices → Receipts", actionMailboxId: "mbx-1" }],
		});

		await assert.rejects(run(), refusal(/the filter “Invoices → Receipts”/));
		assert.deepEqual(deleted, []);
	});

	it("refuses a folder appointed to a role, naming the role", async () => {
		const { run, deleted } = callDelete({ appointments: { Archive: "mbx-1" } });

		await assert.rejects(run(), refusal(/the Archive role/));
		assert.deepEqual(deleted, []);
	});

	it("names both when both are bound", async () => {
		const { run } = callDelete({
			filters: [{ name: "Invoices", actionMailboxId: "mbx-1" }],
			appointments: { Archive: "mbx-1" },
		});

		await assert.rejects(
			run(),
			refusal(/the filter “Invoices” and the Archive role/),
		);
	});

	it("ignores a filter that moves mail into a different folder", async () => {
		const { run, deleted } = callDelete({
			filters: [{ name: "Elsewhere", actionMailboxId: "mbx-9" }],
		});

		assert.deepEqual(await run(), { statusCode: 204 });
		assert.deepEqual(deleted, ["mbx-1"]);
	});

	it("ignores a filter with no move action at all", async () => {
		const { run, deleted } = callDelete({
			filters: [{ name: "Just a label", actionMailboxId: "None" }],
		});

		assert.deepEqual(await run(), { statusCode: 204 });
		assert.deepEqual(deleted, ["mbx-1"]);
	});

	it("records the intent for an ordinary folder", async () => {
		const { run, deleted } = callDelete({});

		assert.deepEqual(await run(), { statusCode: 204 });
		assert.deepEqual(deleted, ["mbx-1"]);
	});
});
