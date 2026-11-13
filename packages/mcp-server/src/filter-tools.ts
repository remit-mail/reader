import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
	FILTER_NO_ACTION,
	type FilterItem,
	FilterRuleV1Schema,
	filterClausesFromRule,
	MAX_FILTER_RULE_DEPTH,
	MAX_FILTER_RULE_LEAVES,
	type OrganizeJobRequestItem,
} from "@remit/data-ports";
import { isNotFoundError } from "@remit/data-ports/errors";
import { deriveAccountConfigId } from "@remit/data-ports/id";
import {
	FilterClauseField,
	FilterMatchOperator,
	FilterScope,
	FilterState,
} from "@remit/domain-enums";
import {
	accept,
	createFilter,
	listFilters,
	ownedAccount,
	queueOrganizeJob,
	type Refused,
	refuse,
	updateFilter,
} from "@remit/mailbox-service";
import { z } from "zod";
import type { McpDeps } from "./deps.js";
import { asJson, refused, toolError } from "./tool-result.js";

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
	...filterClausesFromRule(item.rule),
	rule: item.rule,
	priority: item.priority,
	stop: item.stop,
	actionLabelId: item.actionLabelId,
	actionMailboxId: item.actionMailboxId,
	ruleChangedAt: item.ruleChangedAt,
	createdAt: item.createdAt,
	updatedAt: item.updatedAt,
});

const toOrganizeJob = (job: OrganizeJobRequestItem) => ({
	organizeJobId: job.organizeJobId,
	state: job.state,
	filterId: job.filterId,
	matchedCount: job.matchedCount,
	appliedCount: job.appliedCount,
	failedCount: job.failedCount,
	errorMessage: job.errorMessage,
	createdAt: job.createdAt,
	updatedAt: job.updatedAt,
});

const absentJob = (error: unknown): null => {
	if (!isNotFoundError(error)) throw error;
	return null;
};

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
	.min(1)
	.describe("Literal clauses combined by matchOperator. Send these or rule.");

const rule = FilterRuleV1Schema.describe(
	`A Sieve-like test tree. Send this or literalClauses, never both. At most ${MAX_FILTER_RULE_LEAVES} header, address or hasWords tests and ${MAX_FILTER_RULE_DEPTH} levels, counting the top test. Example: {"version":1,"test":{"test":"allof","tests":[{"test":"address","match":"Is","part":"RegistrableDomain","key":"github.com"},{"test":"not","operand":{"test":"header","match":"Contains","header":"Subject","key":"security"}}]}}`,
);

const priority = z
	.int()
	.describe(
		"Evaluation order: lower runs first; ties go to the most recently changed filter. The first matching filter with a folder decides the move, and labels add up",
	);

const stop = z
	.boolean()
	.describe(
		"When true, a message this filter matches is not evaluated against any later filter",
	);

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
		queue: deps.filters.organizeQueue,
		logger: deps.filters.logger,
	};

	server.registerTool(
		"list_filters",
		{
			description:
				"List the user's mail filters: what each matches (rule, plus literalClauses when the rule is a flat list), its priority and stop, where it moves or labels mail, and whether it is on. A page at a time.",
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
				"Create a filter that sorts new mail, and queue a job that applies it to existing mail. Match with literalClauses for a flat list, or with rule for not, nesting and exact matches. Returns the filter and the organizeJobId of that job. A target folder must be confirmed by the mail server first.",
			inputSchema: {
				accountId,
				name: z.string().min(1).max(256).describe("Name for the filter"),
				scope: scope.default(FilterScope.Standing),
				expiresAt: expiresAt.optional(),
				matchOperator: matchOperator.default(FilterMatchOperator.And),
				literalClauses: literalClauses.optional(),
				rule: rule.optional(),
				priority: priority.default(0),
				stop: stop.default(false),
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
				"Change a filter: its name, clauses or rule, priority, stop, target folder or label, scope, expiry, or turn it on or off. Only the fields given change. A filter whose rule has no clause form (literalClauses is empty in list_filters) changes only through rule. Set applyToExisting to also queue a job that applies the filter to existing mail; its organizeJobId is returned.",
			inputSchema: {
				accountId,
				filterId: z.string().min(1).describe("Filter from list_filters"),
				name: z.string().min(1).max(256).optional(),
				scope: scope.optional(),
				expiresAt: expiresAt.optional(),
				matchOperator: matchOperator.optional(),
				literalClauses: literalClauses.optional(),
				rule: rule.optional(),
				priority: priority.optional(),
				stop: stop.optional(),
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

	server.registerTool(
		"get_organize_job",
		{
			description:
				"Read an organize job that applies a filter to existing mail: its state (Pending, Running, Complete, Failed), how many messages it matched, applied and failed, and the error when it failed.",
			inputSchema: {
				organizeJobId: z
					.string()
					.min(1)
					.describe("organizeJobId from create_filter or update_filter"),
			},
			annotations: { readOnlyHint: true, openWorldHint: false },
		},
		async ({ organizeJobId }) => {
			const job = await deps.organizeJobRequest
				.get(organizeJobId)
				.catch(absentJob);
			if (!job || job.accountConfigId !== accountConfigId) {
				return toolError(
					`Organize job not found: ${organizeJobId}. Use the organizeJobId create_filter or update_filter returned.`,
				);
			}
			return asJson(toOrganizeJob(job));
		},
	);

	server.registerTool(
		"apply_filter",
		{
			description:
				"Apply a filter to existing mail now, without changing the filter. Queues the same job create_filter queues and returns its organizeJobId.",
			inputSchema: {
				accountId,
				filterId: z.string().min(1).describe("Filter from list_filters"),
			},
			annotations: FILTER_WRITE,
		},
		async ({ accountId, filterId }) => {
			const owned = await deps.account
				.get(accountId)
				.then((account) => ownedAccount(account, accountConfigId, "act"))
				.catch(notFound);
			if (!owned.ok) return refused(owned.refusal);
			const filter = await deps.filter
				.get(accountConfigId, filterId)
				.then(accept)
				.catch(notFound);
			if (!filter.ok) return refused(filter.refusal);
			const job = await queueOrganizeJob(organizeDeps, {
				accountConfigId,
				userId,
				filterId,
			});
			return asJson({ organizeJobId: job.organizeJobId, state: job.state });
		},
	);
};
