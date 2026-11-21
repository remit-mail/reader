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
	filterRuleLeaves,
	filterRuleLimitRefusal,
	isListPosition,
	type OrganizeJobRequestItem,
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
import {
	decodeMoveCursor,
	type MoveCursor,
	moveCursorOf,
} from "./move-cursor.js";
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

interface Selection {
	accountId: string;
	sourceMailboxId: string;
	job: OrganizeJobRequestItem;
	batches: number;
	appliedCount: number;
	failedCount: number;
}

const isTerminal = (job: OrganizeJobRequestItem): boolean =>
	job.state === "Complete" || job.state === "Failed";

const continues = (job: OrganizeJobRequestItem): boolean =>
	job.state === "Complete" && job.remainingCount > 0 && job.nextPosition !== "";

const selectionReport = ({ job, ...selection }: Selection) => ({
	accountId: selection.accountId,
	sourceMailboxId: selection.sourceMailboxId,
	organizeJobId: job.organizeJobId,
	state: job.state,
	batches: selection.batches,
	appliedCount: selection.appliedCount,
	failedCount: selection.failedCount,
	...(isTerminal(job)
		? {
				remainingCount: job.remainingCount,
				cursor: moveCursorOf(selection.accountId, job),
			}
		: {}),
	...(job.state === "Failed" ? { errorMessage: job.errorMessage } : {}),
});

const CONTINUE_MESSAGE =
	"Not every message is moved yet. Call move_folder_messages with a cursor to continue; a job still running reports its cursor through get_organize_job once it finishes.";

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
		organizeJobRequest: deps.client.organizeJobRequest,
		queue: deps.client.queues.accountFanout,
		logger: deps.logger,
	};

	const ruleFor = async (args: {
		filterId?: string;
		rule?: FilterRuleV1Item;
	}): Promise<Refusable<FilterRuleV1Item>> => {
		if (args.filterId && args.rule) {
			return invalid("Send filterId or rule, not both.");
		}
		if (args.filterId) {
			const filter = await deps.client.filter.get(
				accountConfigId,
				args.filterId,
			);
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
				deps.client,
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
			const label = await deps.client.label.get(
				accountConfigId,
				args.sourceLabelId,
			);
			const [found] = await labelFoldersFor(deps.client, accountConfigId, [
				label,
			]);
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
		const owned = await deps.client.account
			.get(accountId)
			.then((account) => ownedAccount(account, accountConfigId, "act"));
		if (!owned.ok) return owned;
		const source = folderInAccount(
			await deps.client.mailbox.get(accountId, sourceMailboxId),
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
			deps.client,
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
				deps.client,
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
				const rows = await deps.client.message.get(accountIds);
				const toMove = rows.flatMap((row) => {
					if (row.mailboxId !== trashMailboxId) return [row.messageId];
					alreadyInTrash.push(row.messageId);
					return [];
				});
				if (toMove.length === 0) continue;
				await deps.client.messageMove.moveMessages(
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

	const queueContinuation = (job: OrganizeJobRequestItem) =>
		queueOrganizeJob(organizeDeps, {
			accountConfigId,
			userId,
			predicate: {
				rule: job.rule,
				sourceMailboxId: job.sourceMailboxId,
				sentAfter: job.sentAfter,
				sentBefore: job.sentBefore,
				actionMailboxId: job.actionMailboxId,
				actionLabelId: job.actionLabelId,
				startPosition: job.nextPosition,
			},
		});

	const CURSOR_REFUSAL =
		"This cursor is not one move_folder_messages or get_organize_job returned.";

	const checkedCursor = async (
		encoded: string,
	): Promise<Refusable<MoveCursor>> => {
		const cursor = decodeMoveCursor(encoded);
		if (!cursor || !isListPosition(cursor.startPosition)) {
			return invalid(CURSOR_REFUSAL);
		}
		const owned = await deps.client.account
			.get(cursor.accountId)
			.then((account) => ownedAccount(account, accountConfigId, "act"));
		if (!owned.ok) return owned;
		for (const mailboxId of [cursor.sourceMailboxId, cursor.actionMailboxId]) {
			const folder = folderInAccount(
				await deps.client.mailbox.get(cursor.accountId, mailboxId),
				cursor.accountId,
				"act",
			);
			if (!folder.ok) return folder;
		}
		if (cursor.actionLabelId !== FILTER_NO_ACTION) {
			await deps.client.label.get(accountConfigId, cursor.actionLabelId);
		}
		const tooBig =
			filterRuleLeaves(cursor.rule).length > 0 &&
			filterRuleLimitRefusal(cursor.rule);
		if (tooBig) return invalid(tooBig);
		const rejection = organizePredicateRejection({
			rule: cursor.rule,
			actionLabelId: cursor.actionLabelId,
			actionMailboxId: cursor.actionMailboxId,
		});
		return rejection ? invalid(rejection.message) : accept(cursor);
	};

	const driveBatches = async (selections: Selection[]): Promise<void> => {
		const { budgetMs, pollIntervalMs, sleep, now } = deps.moves;
		const deadline = now() + budgetMs;
		for (;;) {
			for (const selection of selections) {
				if (isTerminal(selection.job)) continue;
				selection.job = await deps.client.organizeJobRequest.get(
					selection.job.organizeJobId,
				);
				if (!isTerminal(selection.job)) continue;
				selection.appliedCount += selection.job.appliedCount;
				selection.failedCount += selection.job.failedCount;
				if (!continues(selection.job) || now() >= deadline) continue;
				selection.job = await queueContinuation(selection.job);
				selection.batches += 1;
			}
			if (selections.every(({ job }) => isTerminal(job))) return;
			const left = deadline - now();
			if (left <= 0) return;
			await sleep(Math.min(pollIntervalMs, left));
		}
	};

	const report = (selections: Selection[]) => {
		const unfinished = selections.some(
			({ job }) => !isTerminal(job) || continues(job),
		);
		return {
			jobs: selections.map(selectionReport),
			...(unfinished ? { continue: CONTINUE_MESSAGE } : {}),
		};
	};

	server.registerTool(
		"move_folder_messages",
		{
			description: `Move every message in a folder, or in a label's folders, or only those matching a filter's rule or a given rule, and optionally only those dated within before/after, into another folder, a label's folder, or Trash. Runs as organize jobs, one per account, each moving at most ${ORGANIZE_MATCH_LIMIT} messages. The tool runs jobs back to back for up to ${Math.round(deps.moves.budgetMs / 1000)} seconds, then reports per account the messages moved, how many still match (remainingCount) and a cursor. While a cursor is not empty, call again with only that cursor to continue the same selection. A job still running when the time is up comes back without a cursor; get_organize_job reports its remainingCount and cursor once it finishes.`,
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
				cursor: z
					.string()
					.min(1)
					.optional()
					.describe(
						"Continue a move where it stopped: a cursor from move_folder_messages or get_organize_job. Send it alone; it carries the source, target and rule.",
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
			cursor,
			...match
		}): Promise<CallToolResult> => {
			if (cursor) {
				const selectionArgs = [
					accountId,
					sourceMailboxId,
					sourceLabelId,
					mailboxId,
					labelId,
					trash,
					before,
					after,
					match.filterId,
					match.rule,
				];
				if (selectionArgs.some((arg) => arg !== undefined)) {
					return refused(
						invalid(
							"Send cursor alone: it already carries the source, target and rule.",
						).refusal,
					);
				}
				const checked = await checkedCursor(cursor).catch(notFound);
				if (!checked.ok) return refused(checked.refusal);
				const { accountId: cursorAccountId, ...predicate } = checked.value;
				const selection: Selection = {
					accountId: cursorAccountId,
					sourceMailboxId: predicate.sourceMailboxId,
					job: await queueOrganizeJob(organizeDeps, {
						accountConfigId,
						userId,
						predicate,
					}),
					batches: 1,
					appliedCount: 0,
					failedCount: 0,
				};
				await driveBatches([selection]);
				return asJson(report([selection]));
			}
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
			const selections: Selection[] = [];
			for (const { source, action } of planned) {
				const job = await queueOrganizeJob(organizeDeps, {
					accountConfigId,
					userId,
					predicate: {
						rule: rule.value,
						sourceMailboxId: source.mailboxId,
						sentAfter: after ?? FILTER_NO_ACTION,
						sentBefore: before ?? FILTER_NO_ACTION,
						startPosition: "",
						...action,
					},
				});
				selections.push({
					accountId: source.accountId,
					sourceMailboxId: source.mailboxId,
					job,
					batches: 1,
					appliedCount: 0,
					failedCount: 0,
				});
			}
			await driveBatches(selections);
			const { skipped } = sources.value;
			return asJson({
				...report(selections),
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
