import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { FILTER_NO_ACTION, type FilterItem } from "@remit/data-ports";
import { isNotFoundError } from "@remit/data-ports/errors";
import { deriveAccountConfigId } from "@remit/data-ports/id";
import {
	FilterClauseField,
	FilterMatchOperator,
	FilterScope,
	FilterState,
} from "@remit/domain-enums";
import {
	createFilter,
	listFilters,
	queueOrganizeJob,
	type Refused,
	refuse,
	updateFilter,
} from "@remit/mailbox-service";
import { z } from "zod";
import type { McpDeps } from "./deps.js";
import { asJson, refused } from "./tool-result.js";

const FILTER_WRITE = {
	readOnlyHint: false,
	destructiveHint: false,
	idempotentHint: false,
	openWorldHint: false,
} as const;

const toFilter = (item: FilterItem) => ({
	filterId: item.filterId,
	name: item.name,
	scope: item.scope,
	expiresAt: item.expiresAt,
	state: item.state,
	disabledReason: item.disabledReason,
	matchOperator: item.matchOperator,
	literalClauses: item.literalClauses,
	actionLabelId: item.actionLabelId,
	actionMailboxId: item.actionMailboxId,
	ruleChangedAt: item.ruleChangedAt,
	createdAt: item.createdAt,
	updatedAt: item.updatedAt,
});

const notFound = (error: unknown): Refused => {
	if (!isNotFoundError(error)) throw error;
	const message = error instanceof Error ? error.message : "Not found";
	return refuse({
		kind: "NotFound",
		message: `${message}. Check the filterId against list_filters.`,
	});
};

const accountId = z.string().min(1).describe("Account from list_mailboxes");

const literalClauses = z
	.array(
		z.object({
			field: z
				.enum(FilterClauseField)
				.describe("Message attribute the clause matches"),
			value: z.string().min(1).max(256).describe("Literal text to match"),
		}),
	)
	.min(1);

const scope = z
	.enum(FilterScope)
	.describe("Standing runs until changed; Temporary stops at expiresAt");

const expiresAt = z
	.string()
	.describe(
		"ISO 8601 date-time with zone offset; only for a Temporary filter, e.g. 2026-12-31T23:59:59+01:00",
	);

const matchOperator = z
	.enum(FilterMatchOperator)
	.describe("And: every clause matches; Or: any clause matches");

const actionMailboxId = z
	.string()
	.min(1)
	.describe(
		`Folder from list_mailboxes to move matching mail into, or "${FILTER_NO_ACTION}"`,
	);

const actionLabelId = z
	.string()
	.min(1)
	.describe(`Label to apply to matching mail, or "${FILTER_NO_ACTION}"`);

export const registerFilterTools = (
	server: McpServer,
	deps: McpDeps,
	userId: string,
): void => {
	const accountConfigId = deriveAccountConfigId(userId);
	const organizeDeps = {
		organizeJobRequest: deps.organizeJobRequest,
		sqsQueueUrl: deps.filters.organizeQueueUrl,
		logger: deps.filters.logger,
	};

	server.registerTool(
		"list_filters",
		{
			description:
				"List the user's mail filters: what each matches, where it moves or labels mail, and whether it is on. A page at a time.",
			inputSchema: {
				accountId,
				continuationToken: z
					.string()
					.optional()
					.describe("Opaque cursor from a previous response"),
			},
			annotations: { readOnlyHint: true, openWorldHint: false },
		},
		async (args) => {
			const page = await listFilters(deps, accountConfigId, {
				accountId: args.accountId,
				continuationToken: args.continuationToken,
			}).catch(notFound);
			if (!page.ok) return refused(page.refusal);
			return asJson({
				items: page.value.items.map(toFilter),
				continuationToken: page.value.continuationToken,
			});
		},
	);

	server.registerTool(
		"create_filter",
		{
			description:
				"Create a filter that sorts new mail, and queue a job that applies it to existing mail. Returns the filter and the organizeJobId of that job. A target folder must be confirmed by the mail server first.",
			inputSchema: {
				accountId,
				name: z.string().min(1).max(256).describe("Name for the filter"),
				scope: scope.default(FilterScope.Standing),
				expiresAt: expiresAt.optional(),
				matchOperator: matchOperator.default(FilterMatchOperator.And),
				literalClauses,
				actionMailboxId: actionMailboxId.default(FILTER_NO_ACTION),
				actionLabelId: actionLabelId.default(FILTER_NO_ACTION),
			},
			annotations: FILTER_WRITE,
		},
		async ({ accountId, ...rule }) => {
			const created = await createFilter(
				{ ...deps, ...organizeDeps },
				{ accountConfigId, userId },
				{ accountId, filter: rule },
			).catch(notFound);
			if (!created.ok) return refused(created.refusal);
			return asJson({
				filter: toFilter(created.value.filter),
				organizeJobId: created.value.organizeJob.organizeJobId,
			});
		},
	);

	server.registerTool(
		"update_filter",
		{
			description:
				"Change a filter: its name, clauses, target folder or label, scope, expiry, or turn it on or off. Only the fields given change. Set applyToExisting to also queue a job that applies the filter to existing mail; its organizeJobId is returned.",
			inputSchema: {
				accountId,
				filterId: z.string().min(1).describe("Filter from list_filters"),
				name: z.string().min(1).max(256).optional(),
				scope: scope.optional(),
				expiresAt: expiresAt.optional(),
				matchOperator: matchOperator.optional(),
				literalClauses: literalClauses.optional(),
				actionMailboxId: actionMailboxId.optional(),
				actionLabelId: actionLabelId.optional(),
				state: z
					.enum(FilterState)
					.optional()
					.describe("Active turns the filter on, Disabled turns it off"),
				applyToExisting: z
					.boolean()
					.optional()
					.describe("Also apply the filter to existing mail"),
			},
			annotations: FILTER_WRITE,
		},
		async ({ accountId, filterId, applyToExisting, ...patch }) => {
			const updated = await updateFilter(deps, accountConfigId, {
				accountId,
				filterId,
				patch,
			}).catch(notFound);
			if (!updated.ok) return refused(updated.refusal);
			const filter = toFilter(updated.value);
			if (!applyToExisting) return asJson({ filter });
			const job = await queueOrganizeJob(organizeDeps, {
				accountConfigId,
				userId,
				filterId,
			});
			return asJson({ filter, organizeJobId: job.organizeJobId });
		},
	);
};
