import type {
	CreateLabelInput as CreateLabelRequestBody,
	LabelResponse,
	UpdateLabelInput as UpdateLabelRequestBody,
} from "@remit/api-openapi-types";
import type {
	CreateLabelInput,
	FilterItem,
	LabelItem,
	UpdateLabelInput,
} from "@remit/data-ports";
import {
	type LabelFolder,
	type LabelFolderDeps,
	labelFoldersFor,
	ownedAccount,
} from "@remit/mailbox-service";
import {
	deleteLabelWithCascade,
	findFiltersForLabel,
} from "../service/label-delete.js";
import { updateLabelFor } from "../service/label-operations.js";
import { unwrap } from "../service/refusal.js";
import type {
	HandlerContext,
	LabelDetailOperationIds,
	LabelOperationIds,
	OperationHandler,
} from "../types.js";

/**
 * Minimal label-service surface the CRUD handlers need — declared as a `Pick`
 * so tests can stub it without a live table.
 */
export interface LabelCrudDeps {
	label: {
		create(input: CreateLabelInput): Promise<LabelItem>;
		get(accountConfigId: string, labelId: string): Promise<LabelItem>;
		update(
			accountConfigId: string,
			labelId: string,
			input: UpdateLabelInput,
		): Promise<LabelItem>;
		delete(accountConfigId: string, labelId: string): Promise<void>;
		listPageByAccountConfig(
			accountConfigId: string,
			options?: { limit?: number; continuationToken?: string },
		): Promise<{ items: LabelItem[]; continuationToken: string | undefined }>;
	};
	filter: {
		listByAccountConfig(accountConfigId: string): Promise<FilterItem[]>;
		delete(accountConfigId: string, filterId: string): Promise<void>;
	};
	messageLabel: {
		removeAllByLabelId(accountConfigId: string, labelId: string): Promise<void>;
	};
}

const foldersOf = async (
	deps: LabelFolderDeps,
	accountConfigId: string,
	label: LabelItem,
): Promise<LabelFolder[]> =>
	(await labelFoldersFor(deps, accountConfigId, [label])).flatMap(
		({ folders }) => folders,
	);

/**
 * `filterCount` and `folders` are computed here, not stored (issue #26) —
 * every other field comes straight off the `LabelItem` row.
 */
const toLabelResponse = (
	item: LabelItem,
	filterCount: number,
	folders: LabelFolder[],
): LabelResponse => ({
	labelId: item.labelId,
	accountConfigId: item.accountConfigId,
	name: item.name,
	color: item.color,
	filterCount,
	folders,
	createdAt: item.createdAt,
	updatedAt: item.updatedAt,
});

export const LabelOperations: Record<
	LabelOperationIds,
	OperationHandler<LabelOperationIds>
> = {
	LabelOperations_listLabels: async (context, ctx: HandlerContext) => {
		const accountConfigId = ctx.identity.accountConfigId;
		const { accountId } = context.request.params as { accountId: string };
		const { continuationToken } = context.request.query as {
			continuationToken?: string;
		};

		const client = ctx.client;
		const account = await client.account.get(accountId);
		unwrap(ownedAccount(account, accountConfigId, "read"));

		const page = await client.label.listPageByAccountConfig(accountConfigId, {
			continuationToken,
		});
		const [filters, labels] = await Promise.all([
			client.filter.listByAccountConfig(accountConfigId),
			labelFoldersFor(client, accountConfigId, page.items),
		]);
		const filterCountByLabelId = new Map<string, number>();
		for (const filter of filters) {
			const labelId = filter.actionLabelId;
			filterCountByLabelId.set(
				labelId,
				(filterCountByLabelId.get(labelId) ?? 0) + 1,
			);
		}

		return {
			items: labels.map(({ label, folders }) =>
				toLabelResponse(
					label,
					filterCountByLabelId.get(label.labelId) ?? 0,
					folders,
				),
			),
			continuationToken: page.continuationToken,
		};
	},

	LabelOperations_createLabel: async (context, ctx: HandlerContext) => {
		const accountConfigId = ctx.identity.accountConfigId;
		const { accountId } = context.request.params as { accountId: string };
		const input = context.request.requestBody as CreateLabelRequestBody;

		const client = ctx.client;
		const account = await client.account.get(accountId);
		unwrap(ownedAccount(account, accountConfigId, "act"));

		const label = await client.label.create({
			accountConfigId,
			name: input.name,
			color: input.color,
		});
		return toLabelResponse(
			label,
			0,
			await foldersOf(client, accountConfigId, label),
		);
	},
};

export const LabelDetailOperations: Record<
	LabelDetailOperationIds,
	OperationHandler<LabelDetailOperationIds>
> = {
	LabelDetailOperations_getLabel: async (context, ctx: HandlerContext) => {
		const accountConfigId = ctx.identity.accountConfigId;
		const { accountId, labelId } = context.request.params as {
			accountId: string;
			labelId: string;
		};

		const client = ctx.client;
		const account = await client.account.get(accountId);
		unwrap(ownedAccount(account, accountConfigId, "read"));

		const label = await client.label.get(accountConfigId, labelId);
		const filters = await findFiltersForLabel(client, accountConfigId, labelId);
		return toLabelResponse(
			label,
			filters.length,
			await foldersOf(client, accountConfigId, label),
		);
	},

	LabelDetailOperations_updateLabel: async (context, ctx: HandlerContext) => {
		const accountConfigId = ctx.identity.accountConfigId;
		const { accountId, labelId } = context.request.params as {
			accountId: string;
			labelId: string;
		};
		const body = context.request.requestBody as UpdateLabelRequestBody;

		return updateLabelFor(
			ctx.client,
			accountConfigId,
			accountId,
			labelId,
			body,
		);
	},

	LabelDetailOperations_deleteLabel: async (context, ctx: HandlerContext) => {
		const accountConfigId = ctx.identity.accountConfigId;
		const { accountId, labelId } = context.request.params as {
			accountId: string;
			labelId: string;
		};

		const client = ctx.client;
		const account = await client.account.get(accountId);
		unwrap(ownedAccount(account, accountConfigId, "act"));

		await deleteLabelWithCascade(client, accountConfigId, labelId);
		return { statusCode: 204 };
	},
};
