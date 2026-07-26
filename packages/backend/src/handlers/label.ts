import type {
	CreateLabelInput,
	FilterItem,
	LabelItem,
	UpdateLabelInput,
} from "@remit/data-ports";
import type { APIGatewayProxyEvent } from "aws-lambda";
import { getAccountConfigIdFromEvent } from "../auth.js";
import { getClient } from "../service/dynamodb.js";
import type {
	LabelDetailOperationIds,
	LabelOperationIds,
	OperationHandler,
} from "../types.js";
import { assertAccountOwnership } from "./account-ownership.js";

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

/**
 * Every filter in the account whose action applies this label (issue #26). The
 * count backs `LabelResponse.filterCount`; the list backs the cascade delete.
 */
export const findFiltersForLabel = async (
	deps: Pick<LabelCrudDeps, "filter">,
	accountConfigId: string,
	labelId: string,
): Promise<FilterItem[]> => {
	const filters = await deps.filter.listByAccountConfig(accountConfigId);
	return filters.filter((filter) => filter.actionLabelId === labelId);
};

/**
 * Not typed against the generated `@remit/api-openapi-types` `LabelResponse`:
 * that package publishes separately from this repo, so a PR that both adds
 * the TypeSpec model and reads it in the same change would typecheck in-tree
 * (fresh local codegen) but fail `check-consumer-typecheck`/`release:dry-run`,
 * which resolve generated `@remit/*` packages off the registry, not the local
 * `build/` output. The internal `LabelItem` (already published) carries every
 * field this needs; `filterCount` is computed here, not stored.
 */
const toLabelResponse = (item: LabelItem, filterCount: number) => ({
	labelId: item.labelId,
	accountConfigId: item.accountConfigId,
	name: item.name,
	color: item.color,
	filterCount,
	createdAt: item.createdAt,
	updatedAt: item.updatedAt,
});

/**
 * Delete a label and cascade in both directions (issue #26): every filter
 * whose `actionLabelId` is this label is deleted outright — never left
 * dangling, never blocking the delete — and every `MessageLabel` row for it is
 * removed. The label row itself is deleted last so a failure mid-cascade never
 * leaves the label gone while its filters or applied-to-messages still exist.
 */
export const deleteLabelWithCascade = async (
	deps: LabelCrudDeps,
	accountConfigId: string,
	labelId: string,
): Promise<void> => {
	const filters = await findFiltersForLabel(deps, accountConfigId, labelId);
	for (const filter of filters) {
		await deps.filter.delete(accountConfigId, filter.filterId);
	}
	await deps.messageLabel.removeAllByLabelId(accountConfigId, labelId);
	await deps.label.delete(accountConfigId, labelId);
};

export const LabelOperations: Record<
	LabelOperationIds,
	OperationHandler<LabelOperationIds>
> = {
	LabelOperations_listLabels: async (context, ...args: unknown[]) => {
		const event = args[0] as APIGatewayProxyEvent;
		const accountConfigId = getAccountConfigIdFromEvent(event);
		const { accountId } = context.request.params as { accountId: string };
		const { continuationToken } = context.request.query as {
			continuationToken?: string;
		};

		const client = await getClient();
		const account = await client.account.get(accountId);
		assertAccountOwnership(account, accountConfigId, "read");

		const page = await client.label.listPageByAccountConfig(accountConfigId, {
			continuationToken,
		});
		const filters = await client.filter.listByAccountConfig(accountConfigId);
		const filterCountByLabelId = new Map<string, number>();
		for (const filter of filters) {
			const labelId = filter.actionLabelId;
			filterCountByLabelId.set(
				labelId,
				(filterCountByLabelId.get(labelId) ?? 0) + 1,
			);
		}

		return {
			items: page.items.map((item) =>
				toLabelResponse(item, filterCountByLabelId.get(item.labelId) ?? 0),
			),
			continuationToken: page.continuationToken,
		};
	},

	LabelOperations_createLabel: async (context, ...args: unknown[]) => {
		const event = args[0] as APIGatewayProxyEvent;
		const accountConfigId = getAccountConfigIdFromEvent(event);
		const { accountId } = context.request.params as { accountId: string };
		const input = context.request.requestBody as {
			name: string;
			color?: LabelItem["color"];
		};

		const client = await getClient();
		const account = await client.account.get(accountId);
		assertAccountOwnership(account, accountConfigId, "act");

		const label = await client.label.create({
			accountConfigId,
			name: input.name,
			color: input.color,
		});
		return toLabelResponse(label, 0);
	},
};

export const LabelDetailOperations: Record<
	LabelDetailOperationIds,
	OperationHandler<LabelDetailOperationIds>
> = {
	LabelDetailOperations_getLabel: async (context, ...args: unknown[]) => {
		const event = args[0] as APIGatewayProxyEvent;
		const accountConfigId = getAccountConfigIdFromEvent(event);
		const { accountId, labelId } = context.request.params as {
			accountId: string;
			labelId: string;
		};

		const client = await getClient();
		const account = await client.account.get(accountId);
		assertAccountOwnership(account, accountConfigId, "read");

		const label = await client.label.get(accountConfigId, labelId);
		const filters = await findFiltersForLabel(client, accountConfigId, labelId);
		return toLabelResponse(label, filters.length);
	},

	LabelDetailOperations_updateLabel: async (context, ...args: unknown[]) => {
		const event = args[0] as APIGatewayProxyEvent;
		const accountConfigId = getAccountConfigIdFromEvent(event);
		const { accountId, labelId } = context.request.params as {
			accountId: string;
			labelId: string;
		};
		const body = context.request.requestBody as {
			name?: string;
			color?: LabelItem["color"];
		};

		const client = await getClient();
		const account = await client.account.get(accountId);
		assertAccountOwnership(account, accountConfigId, "act");

		const updated = await client.label.update(accountConfigId, labelId, body);
		const filters = await findFiltersForLabel(client, accountConfigId, labelId);
		return toLabelResponse(updated, filters.length);
	},

	LabelDetailOperations_deleteLabel: async (context, ...args: unknown[]) => {
		const event = args[0] as APIGatewayProxyEvent;
		const accountConfigId = getAccountConfigIdFromEvent(event);
		const { accountId, labelId } = context.request.params as {
			accountId: string;
			labelId: string;
		};

		const client = await getClient();
		const account = await client.account.get(accountId);
		assertAccountOwnership(account, accountConfigId, "act");

		await deleteLabelWithCascade(client, accountConfigId, labelId);
		return { statusCode: 204 };
	},
};
