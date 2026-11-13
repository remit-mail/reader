import type {
	IAddressRepository,
	IMailboxRepository,
	IMessageFlagRepository,
	IMessageLabelRepository,
	IMessageRepository,
	MessageItem,
	MessageSpamVerdict,
	RescanFailureItem,
	RescanResultItem,
	RescanSuccessItem,
} from "@remit/data-ports";
import { readResolvedSpamSettings } from "@remit/data-ports";
import { isNotFoundError } from "@remit/data-ports/errors";
import {
	ClassificationFailureKind,
	MessageKeywordFlag,
	RescanFailureCode,
	SenderOverride,
	SpamModelOutcome,
} from "@remit/domain-enums";
import type { StorageService } from "@remit/storage-service";
import { recordArrival, spamArrivalOf } from "../arrival-decision.js";
import { parseMessageBody } from "../body-parse.js";
import {
	type ClassifierConsultation,
	consultClassifier,
} from "../classifier/classifier-consult.js";
import {
	type ClassifierConfig,
	type ClassifierGate,
	readClassifierGate,
} from "../classifier/classifier-gate.js";
import {
	classifyParsedMessage,
	extractPrimaryFromEmail,
} from "../classify-message.js";
import type { FilterDecision } from "../filters/pipeline.js";
import { resolveFolderRoleMailboxes } from "../folder-placement.js";
import {
	denormalizeMessageCategory,
	type MessageCategoryDenormalizeDeps,
} from "../message-category.js";
import type { PlaceMessageDeps } from "../place-message.js";
import { isPlacementUnsettled } from "../placement-settled.js";
import { readSenderPlacement } from "../sender-placement.js";
import {
	decideSpamVerdict,
	type SpamConfig,
	spamPlacementOf,
} from "./index.js";

type FailureCode = (typeof RescanFailureCode)[keyof typeof RescanFailureCode];

export const RESCAN_LIMIT = 10;

export interface RescanDeps {
	message: Pick<IMessageRepository, "get" | "update">;
	messageFlag: Pick<IMessageFlagRepository, "hasFlag">;
	messageLabel: Pick<IMessageLabelRepository, "apply" | "listByMessageId">;
	mailbox: Pick<IMailboxRepository, "get">;
	address: Pick<IAddressRepository, "getAddress" | "countInboundForDomain">;
	threadMessage: MessageCategoryDenormalizeDeps["threadMessageService"];
	storage: Pick<StorageService, "retrieve">;
	spam: SpamConfig;
	classifier: ClassifierConfig;
	placement: PlaceMessageDeps & {
		mailboxSpecialUseService: Parameters<typeof resolveFolderRoleMailboxes>[0];
	};
}

export interface RescanAccount {
	accountId: string;
	accountConfigId: string;
}

export interface RescanInput {
	messageIds: string[];
	move: boolean;
}

interface RescanCall {
	move: boolean;
	gate: ClassifierGate;
	ownAddresses: string[];
}

type Outcome =
	| { ok: true; success: RescanSuccessItem }
	| { ok: false; failure: RescanFailureItem };

const RETRYABLE: ReadonlySet<FailureCode> = new Set([
	RescanFailureCode.RateLimited,
	RescanFailureCode.DailyCap,
	RescanFailureCode.NotSettled,
]);

const failed = (messageId: string, code: FailureCode): Outcome => ({
	ok: false,
	failure: { messageId, code, retryable: RETRYABLE.has(code) },
});

const classifierFailure = (
	consulted: ClassifierConsultation,
): FailureCode | undefined => {
	if (consulted.state === "AtLimit") return RescanFailureCode.DailyCap;
	if (consulted.state !== "NoAnswer") return undefined;
	if (consulted.kind === ClassificationFailureKind.RateLimited) {
		return RescanFailureCode.RateLimited;
	}
	throw new Error(
		`The category classifier failed (${consulted.kind}); check the classification provider in settings.`,
	);
};

const MODEL_FAILURE: Partial<
	Record<
		Extract<MessageSpamVerdict, { state: "Checked" }>["modelOutcome"],
		FailureCode
	>
> = {
	[SpamModelOutcome.DailyLimit]: RescanFailureCode.DailyCap,
	[SpamModelOutcome.RateLimited]: RescanFailureCode.RateLimited,
};

const spamFailure = (verdict: MessageSpamVerdict): FailureCode | undefined =>
	verdict.state === "Checked" ? MODEL_FAILURE[verdict.modelOutcome] : undefined;

/**
 * Checks up to {@link RESCAN_LIMIT} messages again with the category
 * classifier and the spam service (RFC 041), in parallel, and answers per
 * message as SQS `SendMessageBatch` does. Category stays write-once (RFC 034):
 * only `uncategorized` mail gets one. A message the owner cleared (Not spam,
 * or a Never in Spam sender) gets its verdict recorded and no spam label, and
 * never moves.
 */
export class RescanService {
	constructor(private readonly deps: RescanDeps) {}

	async rescan(
		account: RescanAccount,
		input: RescanInput,
	): Promise<RescanResultItem> {
		const gate = await readClassifierGate(
			this.deps.classifier,
			account.accountConfigId,
		);
		const ownAddresses = (
			await this.deps.spam.accountService.listAllByAccountConfig(
				account.accountConfigId,
			)
		).map((owned) => owned.email);
		const outcomes = await Promise.all(
			[...new Set(input.messageIds)].map((messageId) =>
				this.rescanOne(
					account,
					{ move: input.move, gate, ownAddresses },
					messageId,
				),
			),
		);
		return {
			successful: outcomes.flatMap((outcome) =>
				outcome.ok ? [outcome.success] : [],
			),
			failed: outcomes.flatMap((outcome) =>
				outcome.ok ? [] : [outcome.failure],
			),
		};
	}

	private async rescanOne(
		account: RescanAccount,
		call: RescanCall,
		messageId: string,
	): Promise<Outcome> {
		const { deps } = this;
		const { move, gate, ownAddresses } = call;
		const message = await deps.message
			.get(messageId)
			.catch((error: unknown) => {
				if (isNotFoundError(error)) return undefined;
				throw error;
			});
		if (!message) return failed(messageId, RescanFailureCode.NotFound);
		const [mailbox] = await deps.mailbox.get(account.accountId, [
			message.mailboxId,
		]);
		if (mailbox?.accountId !== account.accountId) {
			return failed(messageId, RescanFailureCode.NotPermitted);
		}
		if (move && isPlacementUnsettled(message)) {
			return failed(messageId, RescanFailureCode.NotSettled);
		}
		if (!message.bodyStorageKey) {
			return failed(messageId, RescanFailureCode.NotFound);
		}
		const raw = await deps.storage.retrieve(message.bodyStorageKey);
		const parsed = await parseMessageBody(raw);
		const { accountConfigId } = account;
		const sender = await readSenderPlacement(
			deps.address,
			accountConfigId,
			extractPrimaryFromEmail(parsed),
		);

		const consulted = await consultClassifier(
			deps.classifier,
			gate,
			account,
			parsed,
			sender.senderOverride,
			Date.now(),
		);
		const classifierCode = classifierFailure(consulted);
		if (classifierCode) return failed(messageId, classifierCode);

		const { fields: classification } = await classifyParsedMessage(
			deps.address,
			accountConfigId,
			parsed,
		);
		const classifierScores =
			consulted.state === "Answered"
				? consulted.scores
				: message.classifierScores;
		const verdict = await decideSpamVerdict(
			deps.spam,
			deps.address,
			spamArrivalOf({
				account,
				parsed,
				raw,
				internalDate: message.internalDate,
				sender,
				filterDecision: await this.filterDecisionOf(message),
				classifierScores:
					consulted.state === "Answered" ? consulted.scores : [],
				classification,
				classifier: deps.classifier,
				gate,
				ownAddresses,
			}),
		);
		const spamCode = spamFailure(verdict);
		if (spamCode) return failed(messageId, spamCode);

		const cleared =
			sender.senderOverride === SenderOverride.NeverSpam ||
			(await deps.messageFlag.hasFlag(messageId, MessageKeywordFlag.NotJunk));
		const { update, labels } = await recordArrival(deps.spam, {
			account,
			messageId,
			gate: async () => gate,
			classifierVerdict:
				consulted.state === "Answered" ? consulted.verdict : { kind: "None" },
			classifierScores,
			classification,
			currentCategory: message.category,
			spamVerdict: verdict,
			spamPlacement: cleared
				? { action: "None" }
				: spamPlacementOf(
						verdict,
						await readResolvedSpamSettings(deps.spam, accountConfigId),
					),
			placement:
				move && !cleared
					? {
							deps: deps.placement,
							row: message,
							roles: await resolveFolderRoleMailboxes(
								deps.placement.mailboxSpecialUseService,
								account.accountId,
							),
							sender,
							move: true,
							leaveJunk: true,
						}
					: undefined,
		});
		if (update.category !== message.category) {
			await denormalizeMessageCategory(
				{ threadMessageService: deps.threadMessage },
				accountConfigId,
				messageId,
				{ category: update.category },
			);
		}
		await deps.message.update(messageId, update);
		return { ok: true, success: { messageId, verdict, labels } };
	}

	private async filterDecisionOf(
		message: Pick<MessageItem, "messageId" | "filterMove">,
	): Promise<FilterDecision> {
		const applied = await this.deps.messageLabel.listByMessageId(
			message.messageId,
		);
		return {
			labels: applied.flatMap((row) =>
				row.appliedByFilterId
					? [{ labelId: row.labelId, filterId: row.appliedByFilterId }]
					: [],
			),
			...(message.filterMove
				? {
						move: {
							destinationMailboxId: message.filterMove.destinationMailboxId,
							filterId: message.filterMove.filterId,
						},
					}
				: {}),
		};
	}
}
