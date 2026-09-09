/**
 * Every API write that binds a durable reference to a folder requires that
 * folder to be settled (D12, first row; imap-mutations R2: wait). Driven
 * through the real handlers rather than the helper, because the claim is that
 * each call site is wired to it — a helper that nothing calls refuses nothing.
 *
 * The other half of the same invariant is the delete refusal (D16), in
 * `mailbox.test.ts`: a binding is only created against a settled folder and
 * only removed by the user, so a `mailboxId` that names nothing never exists.
 */
import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import type { MailboxItem } from "@remit/data-ports";
import { CanonicalMailboxRole, MailboxSyncStatus } from "@remit/domain-enums";
import type { APIGatewayProxyEvent } from "aws-lambda";
import type { Context } from "openapi-backend";
import { deriveAccountConfigId } from "../auth.js";
import {
	_resetForTest,
	type RemitClient,
	setClient,
} from "../service/data-client.js";
import { FilterDetailOperations, FilterOperations } from "./filter.js";
import { FolderRoleOperations } from "./folder-role.js";
import { MessageBulkOperations } from "./message.js";

const SUB = "cognito-sub-365";
const ACCOUNT_ID = "acc-365";
const CONFIG_ID = deriveAccountConfigId(SUB);
const TARGET = "mbx-target";

const target = (syncStatus: MailboxItem["syncStatus"]): MailboxItem =>
	({
		mailboxId: TARGET,
		accountId: ACCOUNT_ID,
		fullPath: "Receipts",
		hierarchyDelimiter: "/",
		syncStatus,
	}) as MailboxItem;

interface Writes {
	filters: unknown[];
	filterPatches: unknown[];
	appointments: unknown[];
	moves: unknown[];
	copies: unknown[];
}

const world = (syncStatus: MailboxItem["syncStatus"]): Writes => {
	const writes: Writes = {
		filters: [],
		filterPatches: [],
		appointments: [],
		moves: [],
		copies: [],
	};
	const row = target(syncStatus);

	setClient({
		account: {
			get: async () => ({ accountId: ACCOUNT_ID, accountConfigId: CONFIG_ID }),
			listAllByAccountConfig: async () => [{ accountId: ACCOUNT_ID }],
		},
		mailbox: {
			get: async (_accountId: string, mailboxId: string | string[]) =>
				Array.isArray(mailboxId)
					? mailboxId.map((id) => ({ mailboxId: id, accountId: ACCOUNT_ID }))
					: row,
			listAllByAccount: async () => [row],
		},
		message: {
			get: async () => ({ mailboxId: "mbx-source" }),
		},
		filter: {
			get: async () => ({ filterId: "flt-1", scope: "Standing" }),
			update: async (...args: unknown[]) => {
				writes.filterPatches.push(args);
				return { filterId: "flt-1" };
			},
			listByAccountConfig: async () => [],
		},
		filterAnchorTransaction: {
			createWithAnchor: async (input: unknown) => {
				writes.filters.push(input);
				return { filterId: "flt-1" };
			},
		},
		accountSetting: {
			get: async () => null,
			upsert: async (item: unknown) => {
				writes.appointments.push(item);
				return item;
			},
			delete: async () => undefined,
		},
		messageMove: {
			moveMessages: async (...args: unknown[]) => {
				writes.moves.push(args);
			},
			copyMessages: async (...args: unknown[]) => {
				writes.copies.push(args);
			},
		},
	} as unknown as RemitClient);

	return writes;
};

const event = {
	requestContext: { authorizer: { claims: { sub: SUB } } },
} as unknown as APIGatewayProxyEvent;

const call = <T>(
	handler: unknown,
	request: Record<string, unknown>,
): Promise<T> =>
	(handler as (context: Context, event: APIGatewayProxyEvent) => Promise<T>)(
		{ request } as unknown as Context,
		event,
	);

const appoint = () =>
	call(FolderRoleOperations.FolderRoleOperations_appointFolderRole, {
		params: { accountId: ACCOUNT_ID, role: CanonicalMailboxRole.Archive },
		requestBody: { mailboxId: TARGET },
	});

const createFilter = () =>
	call(FilterOperations.FilterOperations_createFilter, {
		params: { accountId: ACCOUNT_ID },
		requestBody: {
			name: "Invoices",
			scope: "Standing",
			actionMailboxId: TARGET,
		},
	});

const updateFilter = () =>
	call(FilterDetailOperations.FilterDetailOperations_updateFilter, {
		params: { accountId: ACCOUNT_ID, filterId: "flt-1" },
		requestBody: { actionMailboxId: TARGET },
	});

const moveMessages = () =>
	call(MessageBulkOperations.MessageBulkOperations_moveMessages, {
		params: {},
		requestBody: { messageIds: ["msg-1"], destinationMailboxId: TARGET },
	});

const copyMessages = () =>
	call(MessageBulkOperations.MessageBulkOperations_copyMessages, {
		params: {},
		requestBody: { messageIds: ["msg-1"], destinationMailboxId: TARGET },
	});

const unready = (error: unknown): boolean =>
	(error as { statusCode?: number }).statusCode === 422 &&
	(error as { publicApiError?: { code?: string } }).publicApiError?.code ===
		"mailbox_not_settled";

const SITES = [
	["appointing a role", appoint, (w: Writes) => w.appointments],
	["creating a filter", createFilter, (w: Writes) => w.filters],
	["updating a filter", updateFilter, (w: Writes) => w.filterPatches],
	["moving messages", moveMessages, (w: Writes) => w.moves],
	["copying messages", copyMessages, (w: Writes) => w.copies],
] as const;

describe("a write that binds to a folder requires a settled folder", () => {
	afterEach(() => {
		_resetForTest();
	});

	for (const [what, run, written] of SITES) {
		for (const state of [
			MailboxSyncStatus.pending,
			MailboxSyncStatus.deleting,
			MailboxSyncStatus.failed,
		]) {
			it(`refuses ${what} against a ${state} folder, writing nothing`, async () => {
				const writes = world(state);

				await assert.rejects(run(), unready);
				assert.deepEqual(written(writes), []);
			});
		}

		it(`accepts ${what} against a settled folder`, async () => {
			const writes = world(MailboxSyncStatus.synced);

			await run();
			assert.equal(written(writes).length > 0, true);
		});
	}

	it("never answers 409 from these paths", async () => {
		// 409 belongs to the folder's own mutation losing a compare-and-set
		// (#362, #363). Reusing it here would make "somebody else is changing this
		// folder" and "the folder you are pointing at is not ready" the same
		// answer, with different copy and different remedies behind it.
		world(MailboxSyncStatus.pending);

		await assert.rejects(
			appoint(),
			(error: unknown) => (error as { statusCode?: number }).statusCode !== 409,
		);
	});

	it("does not gate clearing a role whose folder is on its way out", async () => {
		const writes = world(MailboxSyncStatus.deleting);

		await call(FolderRoleOperations.FolderRoleOperations_appointFolderRole, {
			params: { accountId: ACCOUNT_ID, role: CanonicalMailboxRole.Archive },
			requestBody: { mailboxId: null },
		});

		assert.deepEqual(
			writes.appointments,
			[],
			"the row is deleted, not upserted",
		);
	});

	it("does not gate a filter that applies no move action", async () => {
		// `None` is the sentinel for "no move action", so it binds to nothing.
		const writes = world(MailboxSyncStatus.deleting);

		await call(FilterOperations.FilterOperations_createFilter, {
			params: { accountId: ACCOUNT_ID },
			requestBody: {
				name: "Just a label",
				scope: "Standing",
				actionMailboxId: "None",
			},
		});

		assert.equal(writes.filters.length, 1);
	});
});
