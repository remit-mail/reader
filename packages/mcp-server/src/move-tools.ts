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
} from "@remit/data-ports";
import { deriveAccountConfigId } from "@remit/data-ports/id";
import { FilterMatchOperator } from "@remit/domain-enums";
import {
	accept,
	folderInAccount,
	invalid,
	labelFoldersFor,
	type MoveDestination,
	type MoveTarget,
	moveMessagesTo,
	ownedAccount,
	ownedMessagesByAccount,
	queueOrganizeJob,
	type Refusable,
	resolveMoveDestination,
	sentDateRange,
} from "@remit/mailbox-service";
import { z } from "zod";
import type { McpDeps } from "./deps.js";
import { asJson, notFoundRefusal, refused } from "./tool-result.js";
import { trashFolderOf } from "./trash.js";

const MAX_MOVE_MESSAGES = 500;

const MOVE_WRITE = {
	readOnlyHint: false,
	destructiveHint: false,
	idempotentHint: true,
	openWorldHint: false,
} as const;

const notFound = notFoundRefusal("");

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

const oneTarget = (args: {
	mailboxId?: string;
	labelId?: string;
}): Refusable<MoveTarget> => {
	if (args.mailboxId && args.labelId) {
		return invalid("Send mailboxId or labelId, not both.");
	}
	if (args.mailboxId) return accept({ mailboxId: args.mailboxId });
	if (args.labelId) return accept({ labelId: args.labelId });
	return invalid("Send a target: mailboxId for a folder, or labelId.");
};

type BulkTarget = MoveTarget | { trash: true };

interface FolderSource {
	accountId: string;
	mailboxId: string;
}

interface FolderSources {
	present: FolderSource[];
	skipped: Array<{ accountId: string; folderState: string }>;
}

interface JobAction {
	actionMailboxId: string;
	actionLabelId: string;
}

const oneBulkTarget = (args: {
	mailboxId?: string;
	labelId?: string;
	trash?: boolean;
}): Refusable<BulkTarget> => {
	if (!args.trash) return oneTarget(args);
	if (args.mailboxId || args.labelId) {
		return invalid("Send trash, mailboxId or labelId, not more than one.");
	}
	return accept({ trash: true });
};

const jobAction = (destination: MoveDestination): JobAction => ({
	actionMailboxId: destination.mailboxId,
	actionLabelId:
		destination.kind === "Label" ? destination.labelId : FILTER_NO_ACTION,
});

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
				"Move messages into a folder, or into a label's folder, the way the mail app moves them. A folder takes messages of its own account; a label files each account's messages into that account's label folder. Returns once the moves are queued; the mail server confirms them shortly after.",
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
			const moved = await moveMessagesTo(
				deps,
				accountConfigId,
				ids,
				target.value,
			).catch(notFound);
			if (!moved.ok) return refused(moved.refusal);
			return asJson({
				moved: ids.length,
				destinations: moved.value.map(({ messageIds: _, ...group }) => group),
			});
		},
	);

	const sourcesOf = async (args: {
		accountId?: string;
		sourceMailboxId?: string;
		sourceLabelId?: string;
	}): Promise<Refusable<FolderSources>> => {
		if (args.sourceMailboxId && args.sourceLabelId) {
			return invalid("Send sourceMailboxId or sourceLabelId, not both.");
		}
		if (args.sourceLabelId) {
			const label = await deps.label.get(accountConfigId, args.sourceLabelId);
			const [found] = await labelFoldersFor(deps, accountConfigId, [label]);
			const folders = found?.folders ?? [];
			const present = folders.flatMap((folder) =>
				folder.state === "Present"
					? [{ accountId: folder.accountId, mailboxId: folder.mailboxId }]
					: [],
			);
			if (present.length === 0) {
				return invalid(`Label “${label.name}” has no confirmed folder yet.`);
			}
			return accept({
				present,
				skipped: folders.flatMap((folder) =>
					folder.state === "Present"
						? []
						: [{ accountId: folder.accountId, folderState: folder.state }],
				),
			});
		}
		if (!args.sourceMailboxId || !args.accountId) {
			return invalid(
				"Send a source: accountId with sourceMailboxId for a folder, or sourceLabelId.",
			);
		}
		const { accountId, sourceMailboxId } = args;
		const owned = await deps.account
			.get(accountId)
			.then((account) => ownedAccount(account, accountConfigId, "act"));
		if (!owned.ok) return owned;
		const source = folderInAccount(
			await deps.mailbox.get(accountId, sourceMailboxId),
			accountId,
			"act",
		);
		if (!source.ok) return source;
		return accept({
			present: [{ accountId, mailboxId: sourceMailboxId }],
			skipped: [],
		});
	};

	const actionFor = async (
		source: FolderSource,
		target: BulkTarget,
	): Promise<Refusable<JobAction>> => {
		if ("trash" in target) {
			const trash = await trashFolderOf(deps, source.accountId);
			if (!trash.ok) return trash;
			return accept({
				actionMailboxId: trash.value,
				actionLabelId: FILTER_NO_ACTION,
			});
		}
		const destination = await resolveMoveDestination(
			deps,
			accountConfigId,
			source.accountId,
			target,
		);
		if (!destination.ok) return destination;
		return accept(jobAction(destination.value));
	};

	server.registerTool(
		"trash_messages",
		{
			description:
				"Move messages to Trash in their own account. A message already in Trash is left untouched and reported. Returns once the moves are recorded; the mail server confirms them shortly after.",
			inputSchema: {
				messageIds: z
					.array(z.string().min(1))
					.min(1)
					.max(MAX_MOVE_MESSAGES)
					.describe("Messages from list_threads, search_threads or get_thread"),
			},
			annotations: MOVE_WRITE,
		},
		async ({ messageIds }): Promise<CallToolResult> => {
			const ids = [...new Set(messageIds)];
			const owned = await ownedMessagesByAccount(
				deps,
				ids,
				accountConfigId,
				"act",
			).catch(notFound);
			if (!owned.ok) return refused(owned.refusal);
			const planned: Array<{
				accountId: string;
				trashMailboxId: string;
				messageIds: string[];
			}> = [];
			for (const [accountId, accountIds] of owned.value) {
				const trash = await trashFolderOf(deps, accountId);
				if (!trash.ok) return refused(trash.refusal);
				planned.push({
					accountId,
					trashMailboxId: trash.value,
					messageIds: accountIds,
				});
			}
			let trashed = 0;
			const alreadyInTrash: string[] = [];
			for (const {
				accountId,
				trashMailboxId,
				messageIds: accountIds,
			} of planned) {
				const rows = await deps.message.get(accountIds);
				const toMove = rows.flatMap((row) => {
					if (row.mailboxId !== trashMailboxId) return [row.messageId];
					alreadyInTrash.push(row.messageId);
					return [];
				});
				if (toMove.length === 0) continue;
				await deps.messageMove.moveMessages(
					accountConfigId,
					toMove,
					trashMailboxId,
					accountId,
				);
				trashed += toMove.length;
			}
			return asJson({
				trashed,
				...(alreadyInTrash.length > 0 ? { alreadyInTrash } : {}),
			});
		},
	);

	server.registerTool(
		"move_folder_messages",
		{
			description: `Move every message in a folder, or in a label's folders, or only those matching a filter's rule or a given rule, and optionally only those dated within before/after, into another folder, a label's folder, or Trash. Runs as organize jobs, one per account: returns their organizeJobIds, which get_organize_job reports on. One job moves at most ${ORGANIZE_MATCH_LIMIT} messages; call again while a finished job reports appliedCount above 0.`,
			inputSchema: {
				accountId: z
					.string()
					.min(1)
					.optional()
					.describe(
						"Account from list_mailboxes; required with sourceMailboxId",
					),
				sourceMailboxId: z
					.string()
					.min(1)
					.optional()
					.describe(
						"Folder from list_mailboxes to move messages out of. Send this or sourceLabelId.",
					),
				sourceLabelId: z
					.string()
					.min(1)
					.optional()
					.describe(
						"Label from list_labels: move messages out of its folder in every account. Send this or sourceMailboxId.",
					),
				mailboxId: targetMailboxId,
				labelId: targetLabelId,
				trash: z
					.boolean()
					.optional()
					.describe(
						"true moves the messages to Trash in their own account. Send this, mailboxId or labelId.",
					),
				before: z
					.string()
					.optional()
					.describe(
						"Only messages dated before this, an ISO 8601 date-time with zone offset such as 2026-08-13T00:00:00+02:00",
					),
				after: z
					.string()
					.optional()
					.describe(
						"Only messages dated at or after this, an ISO 8601 date-time with zone offset",
					),
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
			sourceLabelId,
			mailboxId,
			labelId,
			trash,
			before,
			after,
			...match
		}): Promise<CallToolResult> => {
			const target = oneBulkTarget({ mailboxId, labelId, trash });
			if (!target.ok) return refused(target.refusal);
			const sent = sentDateRange({ before, after });
			if (!sent.ok) return refused(sent.refusal);
			const sources = await sourcesOf({
				accountId,
				sourceMailboxId,
				sourceLabelId,
			}).catch(notFound);
			if (!sources.ok) return refused(sources.refusal);
			const planned: Array<{ source: FolderSource; action: JobAction }> = [];
			for (const source of sources.value.present) {
				const action = await actionFor(source, target.value).catch(notFound);
				if (!action.ok) return refused(action.refusal);
				if (action.value.actionMailboxId === source.mailboxId) {
					return refused(
						invalid("The target folder is the source folder.").refusal,
					);
				}
				planned.push({ source, action: action.value });
			}
			const rule = await ruleFor(match).catch(notFound);
			if (!rule.ok) return refused(rule.refusal);
			for (const { action } of planned) {
				const rejection = organizePredicateRejection({
					rule: rule.value,
					...action,
				});
				if (rejection) return refused(invalid(rejection.message).refusal);
			}
			const jobs = [];
			for (const { source, action } of planned) {
				const job = await queueOrganizeJob(organizeDeps, {
					accountConfigId,
					userId,
					predicate: {
						rule: rule.value,
						sourceMailboxId: source.mailboxId,
						sentAfter: after ?? FILTER_NO_ACTION,
						sentBefore: before ?? FILTER_NO_ACTION,
						...action,
					},
				});
				jobs.push({
					accountId: source.accountId,
					sourceMailboxId: source.mailboxId,
					organizeJobId: job.organizeJobId,
					state: job.state,
				});
			}
			const { skipped } = sources.value;
			return asJson({
				jobs,
				...(skipped.length > 0
					? {
							skipped,
							message:
								"These accounts have no confirmed folder for the label yet, so no job was queued for them.",
						}
					: {}),
			});
		},
	);
};
