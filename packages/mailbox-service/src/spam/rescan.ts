import type {
	IAddressRepository,
	IMailboxRepository,
	IMessageFlagRepository,
	IMessageLabelRepository,
	IMessageRepository,
	LabelItem,
	MessageItem,
	MessageSpamVerdict,
	RescanFailureItem,
	RescanResultItem,
	RescanSuccessItem,
} from "@remit/data-ports";
import { isNotFoundError } from "@remit/data-ports/errors";
import {
	ClassificationFailureKind,
	MessageClassificationState,
	MessageKeywordFlag,
	RescanFailureCode,
	SenderOverride,
	SpamAction,
	SpamModelOutcome,
} from "@remit/domain-enums";
import type { StorageService } from "@remit/storage-service";
import { parseMessageBody } from "../body-parse.js";
import { ensureLabel } from "../classification-labels.js";
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
	type ClassifierVerdict,
	classificationLabelOf,
} from "../classifier/classifier-precedence.js";
import {
	classifyParsedMessage,
	extractPrimaryFromEmail,
} from "../classify-message.js";
import type { FilterDecision } from "../filters/pipeline.js";
import {
	placementOf,
	resolveFolderRoleMailboxes,
} from "../folder-placement.js";
import {
	denormalizeMessageCategory,
	hasDecidedCategory,
	type MessageCategoryDenormalizeDeps,
} from "../message-category.js";
import {
	type PlaceMessageDeps,
	type PlacementUpdate,
	placeMessage,
} from "../place-message.js";
import { isPlacementUnsettled } from "../placement-settled.js";
import {
	readSenderPlacement,
	type SenderPlacement,
} from "../sender-placement.js";
import { decideSpamVerdict, type SpamConfig } from "./index.js";
import { spamModelAccessOf } from "./model.js";

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
	spamLabelOf: (kind: CheckedVerdict["kind"]) => Promise<LabelItem>;
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
	Record<CheckedVerdict["modelOutcome"], FailureCode>
> = {
	[SpamModelOutcome.DailyLimit]: RescanFailureCode.DailyCap,
	[SpamModelOutcome.RateLimited]: RescanFailureCode.RateLimited,
};

const spamFailure = (verdict: MessageSpamVerdict): FailureCode | undefined =>
	verdict.state === "Checked" ? MODEL_FAILURE[verdict.modelOutcome] : undefined;

type CheckedVerdict = Extract<MessageSpamVerdict, { state: "Checked" }>;

const flagged = (verdict: MessageSpamVerdict): verdict is CheckedVerdict =>
	verdict.state === "Checked" &&
	(verdict.action === SpamAction.Warn || verdict.action === SpamAction.Junk);

const NO_VERDICT: ClassifierVerdict = { kind: "None" };

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
		const spamLabels = new Map<CheckedVerdict["kind"], Promise<LabelItem>>();
		const spamLabelOf = (kind: CheckedVerdict["kind"]): Promise<LabelItem> => {
			const label =
				spamLabels.get(kind) ??
				ensureLabel(
					this.deps.classifier.labelService,
					account.accountConfigId,
					kind,
				);
			spamLabels.set(kind, label);
			return label;
		};
		const outcomes = await Promise.all(
			[...new Set(input.messageIds)].map((messageId) =>
				this.rescanOne(
					account,
					{ move: input.move, gate, ownAddresses, spamLabelOf },
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
		const fromEmail = extractPrimaryFromEmail(parsed);
		const sender = await readSenderPlacement(
			deps.address,
			accountConfigId,
			fromEmail,
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
		const verdict = await decideSpamVerdict(deps.spam, deps.address, {
			accountConfigId,
			fromEmail,
			rcpt: ownAddresses,
			parsed,
			raw,
			internalDate: message.internalDate,
			sender,
			filterDecision: await this.filterDecisionOf(message),
			classifierScores: consulted.state === "Answered" ? consulted.scores : [],
			model: spamModelAccessOf(deps.classifier, gate, account),
			hasListUnsubscribe: classification.hasListUnsubscribe ?? false,
			dmarc: classification.authResult?.dmarc,
		});
		const spamCode = spamFailure(verdict);
		if (spamCode) return failed(messageId, spamCode);

		const cleared =
			sender.senderOverride === SenderOverride.NeverSpam ||
			(await deps.messageFlag.hasFlag(messageId, MessageKeywordFlag.NotJunk));
		const classifierVerdict =
			consulted.state === "Answered" ? consulted.verdict : NO_VERDICT;

		const labels = await this.applyLabels(
			account,
			message,
			call,
			classifierVerdict,
			!cleared && flagged(verdict) ? verdict : undefined,
		);

		const category = hasDecidedCategory(message.category)
			? message.category
			: classifierVerdict.kind === "Category"
				? classifierVerdict.category
				: classification.category;
		if (category !== message.category) {
			await denormalizeMessageCategory(
				{ threadMessageService: deps.threadMessage },
				accountConfigId,
				messageId,
				{ category },
			);
		}

		const placementUpdate =
			move && !cleared
				? await this.place(
						account,
						message,
						sender,
						classifierVerdict.kind === "Junk" ||
							(verdict.state === "Checked" &&
								verdict.action === SpamAction.Junk),
					)
				: {};

		await deps.message.update(messageId, {
			...classification,
			category,
			classificationState: MessageClassificationState.Examined,
			...(consulted.state === "Answered"
				? { classifierScores: consulted.scores }
				: {}),
			spamVerdict: verdict,
			...placementUpdate,
		});
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

	private async applyLabels(
		account: RescanAccount,
		message: Pick<MessageItem, "messageId">,
		{ gate, spamLabelOf }: RescanCall,
		classifierVerdict: ClassifierVerdict,
		spam: CheckedVerdict | undefined,
	): Promise<string[]> {
		const { deps } = this;
		const classifierLabel =
			gate.state === "On"
				? classificationLabelOf(classifierVerdict)
				: undefined;
		const targets = [
			...(classifierLabel && gate.state === "On"
				? [gate.labels[classifierLabel]]
				: []),
			...(spam ? [await spamLabelOf(spam.kind)] : []),
		];
		for (const label of targets) {
			await deps.messageLabel.apply({
				messageId: message.messageId,
				labelId: label.labelId,
				accountConfigId: account.accountConfigId,
			});
		}
		return targets.map((label) => label.name);
	}

	private async place(
		account: RescanAccount,
		message: MessageItem,
		sender: SenderPlacement,
		junk: boolean,
	): Promise<PlacementUpdate> {
		const { placement } = this.deps;
		const roles = await resolveFolderRoleMailboxes(
			placement.mailboxSpecialUseService,
			account.accountId,
		);
		const folder = placementOf(message.mailboxId, roles);
		if (folder === "junk") return {};
		const placed = await placeMessage(placement, {
			account,
			message,
			placement: folder,
			roles,
			sender,
			junk,
			move: true,
			now: Date.now(),
		});
		return placed.state === "Decided" ? placed.update : {};
	}
}
