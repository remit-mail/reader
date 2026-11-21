import type {
	AddressResponse,
	AddressTrustFlag,
	AppointFolderRoleInput,
	BulkMessageInput,
	BulkUpdateFlagsInput,
	CanonicalMailboxRole,
	LabelResponse,
	OrganizeInput,
	OrganizePreviewResponse,
	RawMessageResponse,
	UpdateAddressInput,
	UpdateFlagsInput,
	UpdateLabelInput,
	UpdateMessageLabelsInput,
} from "@remit/api-openapi-types";
import {
	type AddressFlags,
	type AddressItem,
	type FlagsMergePatch,
	filterRuleFromClauses,
	type LabelItem,
} from "@remit/data-ports";
import {
	BadRequestError,
	ForbiddenError,
	MessagePlacementUnsettledError,
} from "@remit/data-ports/errors";
import { AddressFlagKey, type StarColor } from "@remit/domain-enums";
import { logger } from "@remit/logger";
import {
	folderInAccount,
	guardConnectionCursor,
	isCursorRebuildNeeded,
	labelFoldersFor,
	MailboxCursorPausedError,
	type NeverSpamGrant,
	NoJunkMailboxError,
	ownedAccount,
	ownedMessages,
	resolveFolderPlacement,
	settledFolder,
} from "@remit/mailbox-service";
import { toAccountResponse } from "../handlers/account-guards.js";
import { loadAccountOverrides } from "../handlers/account-overrides.js";
import { loadSignatureForAccount } from "../handlers/account-signature.js";
import {
	resolveAccountFolderAppointments,
	writeFolderRoleAppointment,
} from "../handlers/folder-role-appointments.js";
import type { RemitClient } from "./data-client.js";
import { findFiltersForLabel } from "./label-delete.js";
import { requestNeverSpamBackApply } from "./never-spam.js";
import {
	buildOrganizeMatchDeps,
	matchOrganize,
	ORGANIZE_MATCH_LIMIT,
	type OrganizePredicate,
} from "./organize.js";
import { unwrap } from "./refusal.js";

type FlagKey = (typeof AddressFlagKey)[keyof typeof AddressFlagKey];
type StarColorValue = (typeof StarColor)[keyof typeof StarColor];
const FLAG_KEYS = Object.values(AddressFlagKey) as readonly FlagKey[];

const toAddressResponse = (item: AddressItem): AddressResponse => ({
	addressId: item.addressId,
	accountConfigId: item.accountConfigId,
	displayName: item.displayName,
	localPart: item.localPart,
	domain: item.domain,
	normalizedEmail: item.normalizedEmail,
	flags: item.flags ?? {},
	inboundCount: item.inboundCount ?? 0,
	outboundCount: item.outboundCount ?? 0,
	replyCount: item.replyCount ?? 0,
	lastInboundAt: item.lastInboundAt ?? 0,
	lastReplyAt: item.lastReplyAt ?? 0,
	createdAt: item.createdAt,
	updatedAt: item.updatedAt,
});

const buildFlagsPatch = (input: UpdateAddressInput): FlagsMergePatch => {
	const patch = {} as Record<FlagKey, unknown>;
	if (input.flags) {
		for (const key of FLAG_KEYS) {
			if (!(key in input.flags)) continue;
			const value = (input.flags as Record<FlagKey, unknown>)[key];
			if (value === null) patch[key] = null;
			else if (value !== undefined) patch[key] = value;
		}
	}
	for (const key of input.clearFlags ?? []) {
		if (FLAG_KEYS.includes(key)) patch[key] = null;
	}
	return patch as FlagsMergePatch;
};

const backApplyCategoryFlag = (
	patch: FlagsMergePatch,
): NonNullable<AddressFlags["category"]> | undefined => {
	const flag = patch.category;
	return flag === null ? undefined : flag;
};

export const searchAddressesFor = async (
	client: RemitClient<never>,
	accountConfigId: string,
	query: { q: string; limit?: number; flag?: AddressTrustFlag },
) => {
	const result = await client.address.listByAccountConfig({
		accountConfigId,
		search: query.q.toLowerCase(),
		flag: query.flag,
		limit: query.limit ?? 10,
	});
	return {
		items: result.items.map(toAddressResponse),
		continuationToken: result.continuationToken,
	};
};

export const updateAddressFor = async (
	client: RemitClient<"accountFanout">,
	accountConfigId: string,
	addressId: string,
	input: UpdateAddressInput,
): Promise<AddressResponse> => {
	const existing = await client.address.getAddress(accountConfigId, addressId);
	if (existing.accountConfigId !== accountConfigId) {
		throw new ForbiddenError(`Address ${addressId} not in account config`);
	}
	const patch = buildFlagsPatch(input);
	if (Object.keys(patch).length === 0) return toAddressResponse(existing);
	const updated = await client.address.mergeFlags(
		accountConfigId,
		addressId,
		patch,
	);
	const flag = backApplyCategoryFlag(patch);
	if (flag) {
		await client.queues.accountFanout
			.send({
				body: {
					type: "SenderCategoryBackApply",
					accountConfigId,
					addressId,
					normalizedEmail: updated.normalizedEmail,
					category: flag.value,
					categorySetAt: flag.setAt,
				},
			})
			.catch((cause: unknown) => {
				throw new Error(
					`The ${flag.value} override is saved and applies to this sender's next message, but the pass over their existing mail could not be started. Setting the same category again retries it.`,
					{ cause },
				);
			});
	}
	if (
		patch.neverSpam?.value === true &&
		updated.flags?.neverSpam?.value === true
	) {
		await requestNeverSpamBackApply(client.queues.accountFanout, {
			accountConfigId,
			addressId,
			normalizedEmail: updated.normalizedEmail,
		});
	}
	return toAddressResponse(updated);
};

export const appointFolderRoleFor = async (
	client: RemitClient<never>,
	accountConfigId: string,
	accountId: string,
	role: CanonicalMailboxRole,
	input: AppointFolderRoleInput,
) => {
	const { account, accountSetting, mailbox } = client;
	const existing = await account.get(accountId);
	unwrap(ownedAccount(existing, accountConfigId, "act"));
	let lastKnownPath: string | undefined;
	if (input.mailboxId) {
		const target = await mailbox.get(accountId, input.mailboxId);
		unwrap(folderInAccount(target, accountId, "act"));
		unwrap(settledFolder(target));
		lastKnownPath = target.fullPath;
	}
	await writeFolderRoleAppointment(
		accountSetting,
		accountConfigId,
		accountId,
		role,
		input.mailboxId ?? null,
		lastKnownPath,
	);
	const [signature, overrides, folderAppointments] = await Promise.all([
		loadSignatureForAccount(accountSetting, accountConfigId, accountId),
		loadAccountOverrides(accountSetting, accountConfigId, accountId),
		resolveAccountFolderAppointments(
			{ mailbox, accountSetting },
			accountConfigId,
			accountId,
		),
	]);
	return toAccountResponse(existing, signature, overrides, folderAppointments);
};

export const labelResponseFor = async (
	client: RemitClient<never>,
	accountConfigId: string,
	label: LabelItem,
): Promise<LabelResponse> => {
	const [filters, folders] = await Promise.all([
		findFiltersForLabel(client, accountConfigId, label.labelId),
		labelFoldersFor(client, accountConfigId, [label]),
	]);
	return {
		labelId: label.labelId,
		accountConfigId: label.accountConfigId,
		name: label.name,
		color: label.color,
		filterCount: filters.length,
		folders: folders.flatMap((entry) => entry.folders),
		createdAt: label.createdAt,
		updatedAt: label.updatedAt,
	};
};

export const updateLabelFor = async (
	client: RemitClient<never>,
	accountConfigId: string,
	accountId: string,
	labelId: string,
	input: UpdateLabelInput,
): Promise<LabelResponse> => {
	unwrap(
		ownedAccount(await client.account.get(accountId), accountConfigId, "act"),
	);
	return labelResponseFor(
		client,
		accountConfigId,
		await client.label.update(accountConfigId, labelId, input),
	);
};

export const predicateFromInput = (
	input: OrganizeInput,
): OrganizePredicate => ({
	rule: filterRuleFromClauses({
		matchOperator: input.matchOperator,
		literalClauses: input.literalClauses,
	}),
	actionLabelId: input.actionLabelId,
	actionMailboxId: input.actionMailboxId,
});

export const previewOrganizeFor = async (
	client: RemitClient<never>,
	accountConfigId: string,
	accountId: string,
	input: OrganizeInput,
): Promise<OrganizePreviewResponse> => {
	unwrap(
		ownedAccount(await client.account.get(accountId), accountConfigId, "read"),
	);
	if (input.filterId) {
		throw new BadRequestError(
			"Preview takes a rule, not a saved filter. Run the filter to apply it.",
		);
	}
	const result = await matchOrganize(
		buildOrganizeMatchDeps(client),
		accountConfigId,
		predicateFromInput(input),
		ORGANIZE_MATCH_LIMIT,
	);
	if (result.rejected) throw new BadRequestError(result.rejected.message);
	return {
		matchedCount: result.messageIds.length,
		messageIds: result.messageIds,
	};
};

export const emptyTrashFor = async (
	client: RemitClient<"sync">,
	accountConfigId: string,
	accountId: string,
) => {
	unwrap(
		ownedAccount(await client.account.get(accountId), accountConfigId, "act"),
	);
	return client.messageMove.emptyTrash(accountConfigId, accountId);
};

export const getRawMessageFor = async (
	client: RemitClient<"sync" | "messageManagement">,
	accountConfigId: string,
	messageId: string,
): Promise<RawMessageResponse> => {
	const accountId = unwrap(
		await ownedMessages(client, [messageId], accountConfigId, "read"),
	);
	const message = await client.message.get(messageId);
	if (!message.bodyStorageKey) {
		const mailbox = await client.mailbox.get(accountId, message.mailboxId);
		if (isCursorRebuildNeeded(mailbox.cursorState)) {
			logger.debug(
				{
					accountId,
					mailboxId: mailbox.mailboxId,
					messageId,
					cursorState: mailbox.cursorState,
				},
				"Mailbox cursor not normal; skipping IMAP body backfill for this request",
			);
		} else {
			const folder = {
				mailboxId: mailbox.mailboxId,
				fullPath: mailbox.fullPath,
				initialSyncCompletedAt: mailbox.initialSyncCompletedAt,
				createdAt: mailbox.createdAt,
				placement: await resolveFolderPlacement(
					client.mailboxSpecialUse,
					accountId,
					mailbox.mailboxId,
				),
			};
			const scope = await client.createConnectionScope(accountId);
			const connection = guardConnectionCursor(
				await scope.getConnection(),
				{ mailboxService: client.mailbox },
				accountId,
				mailbox,
			);
			await client.bodySync
				.fetchAndGetBody(messageId, accountId, accountConfigId, folder, () =>
					Promise.resolve(connection),
				)
				.catch((error: unknown) => {
					if (!(error instanceof MailboxCursorPausedError)) throw error;
					logger.debug(
						{
							accountId,
							mailboxId: mailbox.mailboxId,
							messageId,
							cursorState: error.state,
						},
						"Mailbox cursor not normal; skipping IMAP body backfill for this request",
					);
				})
				.finally(() => scope.disconnect());
		}
	}
	const stored = await client.message.get(messageId);
	if (!stored.bodyStorageKey) {
		throw new Error(
			`Raw source unavailable for message ${messageId}: no bodyStorageKey after backfill`,
		);
	}
	return {
		raw: (await client.storage.retrieve(stored.bodyStorageKey)).toString(
			"latin1",
		),
	};
};

export const updateMessageFlagsFor = async (
	client: RemitClient<"sync">,
	accountConfigId: string,
	messageId: string,
	input: UpdateFlagsInput,
) => {
	const accountId = unwrap(
		await ownedMessages(client, [messageId], accountConfigId, "act"),
	);
	const result = await client.flagQueue.updateFlags(
		accountConfigId,
		messageId,
		accountId,
		{
			isRead: input.isRead,
			isStarred: input.isStarred,
			starColor: input.starColor as StarColorValue | undefined,
		},
	);
	return {
		messageId: result.messageId,
		isRead: result.isRead,
		isStarred: result.isStarred,
	};
};

export const updateFlagsFor = async (
	client: RemitClient<"sync">,
	accountConfigId: string,
	input: BulkUpdateFlagsInput,
) => {
	if (input.messageIds.length === 0) {
		return { successCount: 0, failureCount: 0 };
	}
	const accountId = unwrap(
		await ownedMessages(client, input.messageIds, accountConfigId, "act"),
	);
	for (const messageId of input.messageIds) {
		await client.flagQueue.updateFlags(accountConfigId, messageId, accountId, {
			isRead: input.isRead,
			isStarred: input.isStarred,
			starColor: input.starColor as StarColorValue | undefined,
		});
	}
	return { successCount: input.messageIds.length, failureCount: 0 };
};

export const updateMessageLabelsFor = async (
	client: RemitClient<never>,
	accountConfigId: string,
	input: UpdateMessageLabelsInput,
) => {
	if (input.messageIds.length === 0) {
		return { successCount: 0, failureCount: 0 };
	}
	unwrap(await ownedMessages(client, input.messageIds, accountConfigId, "act"));
	await client.label.get(accountConfigId, input.labelId);
	for (const messageId of input.messageIds) {
		if (input.action === "Apply") {
			await client.messageLabel.apply({
				accountConfigId,
				messageId,
				labelId: input.labelId,
			});
		} else {
			await client.messageLabel.remove(messageId, input.labelId);
		}
	}
	return { successCount: input.messageIds.length, failureCount: 0 };
};

export interface SpamReportBulkFailure {
	messageId: string;
	reason: string;
}

export interface SpamReportBulkOutcome {
	successCount: number;
	failureCount: number;
	failures?: SpamReportBulkFailure[];
}

export const GENERIC_FAILURE_REASON =
	"This message could not be processed. Please try again. If it keeps failing, report it.";

const failureReason = (reason: unknown): string => {
	if (reason instanceof MessagePlacementUnsettledError) {
		return "This message is still being moved on the mail server. Try again in a moment.";
	}
	if (reason instanceof NoJunkMailboxError) return reason.message;
	return GENERIC_FAILURE_REASON;
};

export const settleSpamReportBulk = async (
	messageIds: string[],
	run: (messageId: string) => Promise<void>,
): Promise<SpamReportBulkOutcome> => {
	const results = await Promise.allSettled(messageIds.map(run));
	let successCount = 0;
	const failures: SpamReportBulkFailure[] = [];
	results.forEach((result, index) => {
		if (result.status === "fulfilled") {
			successCount += 1;
			return;
		}
		const messageId = messageIds[index];
		failures.push({ messageId, reason: failureReason(result.reason) });
		logger.error(
			{ messageId, error: result.reason },
			"spam-report bulk operation failed for one message",
		);
	});
	return {
		successCount,
		failureCount: failures.length,
		...(failures.length > 0 ? { failures } : {}),
	};
};

export const reportSpamFor = async (
	client: RemitClient<"sync">,
	accountConfigId: string,
	setBy: string,
	input: BulkMessageInput,
) => {
	const messageIds = [...new Set(input.messageIds)];
	if (messageIds.length === 0) return { successCount: 0, failureCount: 0 };
	const accountId = unwrap(
		await ownedMessages(client, messageIds, accountConfigId, "act"),
	);
	return settleSpamReportBulk(messageIds, (messageId) =>
		client.spamReport.reportSpam({
			accountConfigId,
			accountId,
			messageId,
			setBy,
		}),
	);
};

export const notSpamFor = async (
	client: RemitClient<"sync" | "accountFanout">,
	accountConfigId: string,
	setBy: string,
	input: BulkMessageInput,
) => {
	const messageIds = [...new Set(input.messageIds)];
	if (messageIds.length === 0) return { successCount: 0, failureCount: 0 };
	const accountId = unwrap(
		await ownedMessages(client, messageIds, accountConfigId, "act"),
	);
	const grants = new Map<string, NeverSpamGrant>();
	const outcome = await settleSpamReportBulk(messageIds, async (messageId) => {
		const grant = await client.spamReport.notSpam({
			accountConfigId,
			accountId,
			messageId,
			setBy,
		});
		if (grant) grants.set(grant.addressId, grant);
	});
	const unstarted: { grant: NeverSpamGrant; cause: unknown }[] = [];
	await Promise.all(
		[...grants.values()].map((grant) =>
			requestNeverSpamBackApply(client.queues.accountFanout, grant).catch(
				(cause: unknown) => unstarted.push({ grant, cause }),
			),
		),
	);
	if (unstarted.length > 0) {
		const senders = unstarted
			.map(({ grant }) => grant.normalizedEmail)
			.join(", ");
		throw new Error(
			`Never spam is saved for ${senders}, but their other mail in Spam did not move. Press Not spam again, or turn never spam on from the sender's settings, to retry.`,
			{ cause: unstarted.map(({ cause }) => cause) },
		);
	}
	return outcome;
};
