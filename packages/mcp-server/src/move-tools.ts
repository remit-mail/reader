import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import {
	ORGANIZE_MATCH_LIMIT,
	organizePredicateRejection,
} from "@remit/backend/organize";
import {
	FILTER_NO_ACTION,
	type FilterRuleV1Item,
	FilterRuleV1Schema,
	filterRuleFromClauses,
	filterRuleLimitRefusal,
	type MailboxItem,
} from "@remit/data-ports";
import { isNotFoundError } from "@remit/data-ports/errors";
import { deriveAccountConfigId } from "@remit/data-ports/id";
import { FilterMatchOperator } from "@remit/domain-enums";
import {
	accept,
	folderInAccount,
	invalid,
	moveMessagesToFolder,
	moveMessagesToLabel,
	ownedAccount,
	queueOrganizeJob,
	type Refusable,
	type Refused,
	refuse,
	settledFolder,
} from "@remit/mailbox-service";
import { z } from "zod";
import type { McpDeps } from "./deps.js";
import { asJson, refused } from "./tool-result.js";

const MAX_MOVE_MESSAGES = 500;

const MOVE_WRITE = {
	readOnlyHint: false,
	destructiveHint: false,
	idempotentHint: true,
	openWorldHint: false,
} as const;

const notFound = (error: unknown): Refused => {
	if (!isNotFoundError(error)) throw error;
	return refuse({
		kind: "NotFound",
		message: error instanceof Error ? error.message : "Not found",
	});
};

const EVERY_MESSAGE: FilterRuleV1Item = filterRuleFromClauses({
	matchOperator: FilterMatchOperator.And,
	literalClauses: [],
});

const targetMailboxId = z
	.string()
	.min(1)
	.optional()
	.describe("Folder from list_mailboxes to move into. Send this or labelId.");

const targetLabelId = z
	.string()
	.min(1)
	.optional()
	.describe(
		"Label from list_labels: the messages move into its folder in their account and get the label. Send this or mailboxId.",
	);

type Target = { mailboxId: string } | { labelId: string };

const oneTarget = (args: {
	mailboxId?: string;
	labelId?: string;
}): Refusable<Target> => {
	if (args.mailboxId && args.labelId) {
		return invalid("Send mailboxId or labelId, not both.");
	}
	if (args.mailboxId) return accept({ mailboxId: args.mailboxId });
	if (args.labelId) return accept({ labelId: args.labelId });
	return invalid("Send a target: mailboxId for a folder, or labelId.");
};

interface JobAction {
	actionMailboxId: string;
	actionLabelId: string;
}

const settledTarget = (
	folder: MailboxItem,
	accountId: string,
): Refusable<MailboxItem> => {
	const owned = folderInAccount(folder, accountId, "act");
	if (!owned.ok) return owned;
	return settledFolder(folder);
};

export const registerMoveTools = (
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

	const actionFor = async (
		accountId: string,
		target: Target,
	): Promise<Refusable<JobAction>> => {
		if ("mailboxId" in target) {
			const folder = await deps.mailbox.get(accountId, target.mailboxId);
			const settled = settledTarget(folder, accountId);
			if (!settled.ok) return settled;
			return accept({
				actionMailboxId: folder.mailboxId,
				actionLabelId: FILTER_NO_ACTION,
			});
		}
		const label = await deps.label.get(accountConfigId, target.labelId);
		const mapped = await deps.labelMailbox.get(label.labelId, accountId);
		if (!mapped) {
			return invalid(
				`Label “${label.name}” has no folder in this account yet. Call create_label with the same name to add it.`,
			);
		}
		const folder = await deps.mailbox.get(accountId, mapped.mailboxId);
		const settled = settledTarget(folder, accountId);
		if (!settled.ok) return settled;
		return accept({
			actionMailboxId: folder.mailboxId,
			actionLabelId: label.labelId,
		});
	};

	const ruleFor = async (args: {
		filterId?: string;
		rule?: FilterRuleV1Item;
	}): Promise<Refusable<FilterRuleV1Item>> => {
		if (args.filterId && args.rule) {
			return invalid("Send filterId or rule, not both.");
		}
		if (args.filterId) {
			const filter = await deps.filter.get(accountConfigId, args.filterId);
			return accept(filter.rule);
		}
		if (!args.rule) return accept(EVERY_MESSAGE);
		const tooBig = filterRuleLimitRefusal(args.rule);
		return tooBig ? invalid(tooBig) : accept(args.rule);
	};

	server.registerTool(
		"move_messages",
		{
			description:
				"Move messages into a folder, or into a label's folder, the way the mail app moves them. All messages must be in one account. Returns once the moves are queued; the mail server confirms them shortly after.",
			inputSchema: {
				messageIds: z
					.array(z.string().min(1))
					.min(1)
					.max(MAX_MOVE_MESSAGES)
					.describe("Messages from list_threads, search_threads or get_thread"),
				mailboxId: targetMailboxId,
				labelId: targetLabelId,
			},
			annotations: MOVE_WRITE,
		},
		async ({ messageIds, ...args }): Promise<CallToolResult> => {
			const target = oneTarget(args);
			if (!target.ok) return refused(target.refusal);
			const ids = [...new Set(messageIds)];
			const moved = await ("mailboxId" in target.value
				? moveMessagesToFolder(
						deps,
						accountConfigId,
						ids,
						target.value.mailboxId,
					)
				: moveMessagesToLabel(deps, accountConfigId, ids, target.value.labelId)
			).catch(notFound);
			if (!moved.ok) return refused(moved.refusal);
			return asJson({ moved: ids.length, ...moved.value });
		},
	);

	server.registerTool(
		"move_folder_messages",
		{
			description: `Move every message in one folder, or only those matching a filter's rule or a given rule, into another folder or a label's folder. Runs as an organize job: returns its organizeJobId, which get_organize_job reports on. One job moves at most ${ORGANIZE_MATCH_LIMIT} messages; when matchedCount reaches that, call again to move the rest.`,
			inputSchema: {
				accountId: z.string().min(1).describe("Account from list_mailboxes"),
				sourceMailboxId: z
					.string()
					.min(1)
					.describe("Folder from list_mailboxes to move messages out of"),
				mailboxId: targetMailboxId,
				labelId: targetLabelId,
				filterId: z
					.string()
					.min(1)
					.optional()
					.describe(
						"Only move messages this filter's rule matches; the filter's own action is ignored",
					),
				rule: FilterRuleV1Schema.optional().describe(
					"Only move messages this rule matches, in the shape create_filter takes. Send this or filterId, or neither to move everything.",
				),
			},
			annotations: { ...MOVE_WRITE, idempotentHint: false },
		},
		async ({
			accountId,
			sourceMailboxId,
			mailboxId,
			labelId,
			...match
		}): Promise<CallToolResult> => {
			const target = oneTarget({ mailboxId, labelId });
			if (!target.ok) return refused(target.refusal);
			const owned = await deps.account
				.get(accountId)
				.then((account) => ownedAccount(account, accountConfigId, "act"))
				.catch(notFound);
			if (!owned.ok) return refused(owned.refusal);
			const source = await deps.mailbox
				.get(accountId, sourceMailboxId)
				.then((folder) => folderInAccount(folder, accountId, "act"))
				.catch(notFound);
			if (!source.ok) return refused(source.refusal);
			const action = await actionFor(accountId, target.value).catch(notFound);
			if (!action.ok) return refused(action.refusal);
			if (action.value.actionMailboxId === sourceMailboxId) {
				return refused(
					invalid("The target folder is the source folder.").refusal,
				);
			}
			const rule = await ruleFor(match).catch(notFound);
			if (!rule.ok) return refused(rule.refusal);
			const rejection = organizePredicateRejection({
				rule: rule.value,
				...action.value,
			});
			if (rejection) return refused(invalid(rejection.message).refusal);
			const job = await queueOrganizeJob(organizeDeps, {
				accountConfigId,
				userId,
				predicate: {
					rule: rule.value,
					sourceMailboxId,
					...action.value,
				},
			});
			return asJson({ organizeJobId: job.organizeJobId, state: job.state });
		},
	);
};
