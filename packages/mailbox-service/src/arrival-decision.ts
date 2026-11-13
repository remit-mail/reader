import {
	type IAddressRepository,
	type IMessageFlagRepository,
	type IMessageLabelRepository,
	type IMessageRepository,
	type MessageItem,
	type MessageSpamVerdict,
	NOT_CHECKED,
	readResolvedSpamSettings,
	type SpamSettingsItem,
} from "@remit/data-ports";
import {
	ClassificationFailureKind,
	MessageClassificationState,
	MessageKeywordFlag,
	SenderOverride,
	SpamModelOutcome,
} from "@remit/domain-enums";
import type { ParsedMail } from "mailparser";
import { ensureLabel } from "./classification-labels.js";
import { consultClassifier } from "./classifier/classifier-consult.js";
import type {
	ClassifierConfig,
	ClassifierGate,
} from "./classifier/classifier-gate.js";
import {
	type ClassifierVerdict,
	classificationLabelOf,
} from "./classifier/classifier-precedence.js";
import {
	classifyParsedMessage,
	extractPrimaryFromEmail,
} from "./classify-message.js";
import type { FilterDecision } from "./filters/pipeline.js";
import { type FolderRoleMailboxes, placementOf } from "./folder-placement.js";
import {
	denormalizeMessageCategory,
	hasDecidedCategory,
	type MessageCategoryDenormalizeDeps,
	type MessageCategoryValue,
} from "./message-category.js";
import {
	type PlaceMessageDeps,
	type PlacementUpdate,
	placeMessage,
} from "./place-message.js";
import {
	readSenderPlacement,
	type SenderPlacement,
} from "./sender-placement.js";
import {
	decideSpamVerdict,
	type SpamArrival,
	type SpamConfig,
	type SpamPlacement,
	spamModelAccessOf,
	spamPlacementOf,
} from "./spam/index.js";

const NO_SPAM_PLACEMENT: SpamPlacement = { action: "None" };

export interface ArrivalSpam {
	verdict: MessageSpamVerdict | undefined;
	placement: SpamPlacement;
}

/**
 * RFC 041 stages 1 to 3 for one message, and what placement does with the
 * verdict. A message with no spam arrival gets no verdict; a message the
 * owner cleared keeps its verdict and gets no spam placement.
 */
export const decideArrivalSpam = async (
	spam: SpamConfig,
	address: Pick<IAddressRepository, "countInboundForDomain">,
	arrival: SpamArrival | undefined,
	settings: () => Promise<SpamSettingsItem>,
	cleared: boolean,
): Promise<ArrivalSpam> => {
	if (!arrival) return { verdict: undefined, placement: NO_SPAM_PLACEMENT };
	const verdict = await decideSpamVerdict(spam, address, arrival);
	return {
		verdict,
		placement: cleared
			? NO_SPAM_PLACEMENT
			: spamPlacementOf(verdict, await settings()),
	};
};

export interface ArrivalRecordDeps {
	spam: Pick<SpamConfig, "labelService" | "messageLabelService">;
	classifierLabels: Pick<IMessageLabelRepository, "apply"> | undefined;
	message: Pick<IMessageRepository, "get">;
	threadMessage: MessageCategoryDenormalizeDeps["threadMessageService"];
	placement: PlaceMessageDeps | undefined;
}

export interface ArrivalPlacement {
	row: MessageItem;
	roles: FolderRoleMailboxes;
	sender: SenderPlacement;
	move: boolean;
	leaveJunk: boolean;
}

export interface ArrivalRecordInput {
	account: { accountId: string; accountConfigId: string };
	messageId: string;
	gate: ClassifierGate;
	classifierVerdict: ClassifierVerdict;
	spamPlacement: SpamPlacement;
	placement: ArrivalPlacement | undefined;
	headerCategory: MessageCategoryValue;
	snippet?: string;
	listId?: string;
}

export interface ArrivalRecord {
	placementUpdate: PlacementUpdate;
	category: MessageCategoryValue;
	labels: string[];
}

const place = async (
	deps: PlaceMessageDeps | undefined,
	input: ArrivalRecordInput,
	placement: ArrivalPlacement | undefined,
): Promise<PlacementUpdate> => {
	if (!deps || !placement) return {};
	const folder = placementOf(placement.row.mailboxId, placement.roles);
	if (folder === "junk" && placement.leaveJunk) return {};
	const placed = await placeMessage(deps, {
		account: input.account,
		message: placement.row,
		placement: folder,
		roles: placement.roles,
		sender: placement.sender,
		junk:
			input.classifierVerdict.kind === "Junk" ||
			input.spamPlacement.action === "Junk",
		move: placement.move,
		now: Date.now(),
	});
	return placed.state === "Decided" ? placed.update : {};
};

/**
 * What body sync and rescan record once the classifier and the spam service
 * have answered: placement, the classifier's and the spam verdict's labels,
 * and the write-once category (RFC 034) on every thread row. The label rides
 * on the messageId, which a placement move keeps, so it neither waits for the
 * move to settle nor needs reconciling after it.
 */
export const recordArrival = async (
	deps: ArrivalRecordDeps,
	input: ArrivalRecordInput,
): Promise<ArrivalRecord> => {
	const { account, messageId } = input;
	const placementUpdate = await place(deps.placement, input, input.placement);

	const labels: string[] = [];
	const classifierLabel = classificationLabelOf(input.classifierVerdict);
	if (
		deps.classifierLabels &&
		classifierLabel !== undefined &&
		input.gate.state === "On"
	) {
		const label = input.gate.labels[classifierLabel];
		await deps.classifierLabels.apply({
			messageId,
			labelId: label.labelId,
			accountConfigId: account.accountConfigId,
		});
		labels.push(label.name);
	}
	if (input.spamPlacement.action !== "None") {
		const label = await ensureLabel(
			deps.spam.labelService,
			account.accountConfigId,
			input.spamPlacement.label,
		);
		await deps.spam.messageLabelService.apply({
			messageId,
			labelId: label.labelId,
			accountConfigId: account.accountConfigId,
		});
		labels.push(label.name);
	}

	const existing = await deps.message.get(messageId);
	const category = hasDecidedCategory(existing.category)
		? existing.category
		: input.classifierVerdict.kind === "Category"
			? input.classifierVerdict.category
			: input.headerCategory;
	await denormalizeMessageCategory(
		{ threadMessageService: deps.threadMessage },
		account.accountConfigId,
		messageId,
		{
			category,
			...(input.snippet !== undefined ? { snippet: input.snippet } : {}),
			...(input.listId !== undefined ? { listId: input.listId } : {}),
		},
	);
	return { placementUpdate, category, labels };
};

export interface ClassifyAndRecordDeps extends ArrivalRecordDeps {
	spam: SpamConfig;
	classifier: ClassifierConfig;
	address: Pick<IAddressRepository, "getAddress" | "countInboundForDomain">;
	message: Pick<IMessageRepository, "get" | "update">;
	messageFlag: Pick<IMessageFlagRepository, "hasFlag">;
	messageLabel: Pick<IMessageLabelRepository, "listByMessageId">;
	roles: (accountId: string) => Promise<FolderRoleMailboxes>;
}

export interface ClassifyAndRecordInput {
	account: { accountId: string; accountConfigId: string };
	message: MessageItem;
	raw: Buffer;
	parsed: ParsedMail;
	gate: ClassifierGate;
	ownAddresses: string[];
	move: boolean;
}

type CheckedVerdict = Extract<MessageSpamVerdict, { state: "Checked" }>;

export type ClassifyAndRecordOutcome =
	| { state: "Recorded"; verdict: MessageSpamVerdict; labels: string[] }
	| { state: "DailyCap" }
	| { state: "RateLimited" };

const MODEL_LIMITED: Partial<
	Record<CheckedVerdict["modelOutcome"], ClassifyAndRecordOutcome>
> = {
	[SpamModelOutcome.DailyLimit]: { state: "DailyCap" },
	[SpamModelOutcome.RateLimited]: { state: "RateLimited" },
};

const filterDecisionOf = async (
	messageLabel: Pick<IMessageLabelRepository, "listByMessageId">,
	message: Pick<MessageItem, "messageId" | "filterMove">,
): Promise<FilterDecision> => {
	const applied = await messageLabel.listByMessageId(message.messageId);
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
};

/**
 * Classify a stored message again and record the outcome, for rescan (RFC
 * 041). A category is set only on `uncategorized` mail. A message the owner
 * cleared (Not spam, or a Never in Spam sender) gets its verdict and no spam
 * label, and never moves. A reached limit records nothing, so the caller can
 * retry. Any classifier failure other than a 429 throws.
 */
export const classifyAndRecord = async (
	deps: ClassifyAndRecordDeps,
	input: ClassifyAndRecordInput,
): Promise<ClassifyAndRecordOutcome> => {
	const { account, message, parsed, gate } = input;
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
	if (consulted.state === "AtLimit") return { state: "DailyCap" };
	if (consulted.state === "NoAnswer") {
		if (consulted.kind === ClassificationFailureKind.RateLimited) {
			return { state: "RateLimited" };
		}
		throw new Error(
			`The category classifier failed (${consulted.kind}); check the classification provider in settings.`,
		);
	}

	const { fields: classification } = await classifyParsedMessage(
		deps.address,
		accountConfigId,
		parsed,
	);
	const cleared =
		sender.senderOverride === SenderOverride.NeverSpam ||
		(await deps.messageFlag.hasFlag(
			message.messageId,
			MessageKeywordFlag.NotJunk,
		));
	const spam = await decideArrivalSpam(
		deps.spam,
		deps.address,
		{
			accountConfigId,
			fromEmail,
			rcpt: input.ownAddresses,
			parsed,
			raw: input.raw,
			internalDate: message.internalDate,
			sender,
			filterDecision: await filterDecisionOf(deps.messageLabel, message),
			classifierScores: consulted.state === "Answered" ? consulted.scores : [],
			model: spamModelAccessOf(deps.classifier, gate, account),
			hasListUnsubscribe: classification.hasListUnsubscribe ?? false,
			dmarc: classification.authResult?.dmarc,
		},
		() => readResolvedSpamSettings(deps.spam, accountConfigId),
		cleared,
	);
	const verdict = spam.verdict ?? NOT_CHECKED;
	const limited =
		verdict.state === "Checked"
			? MODEL_LIMITED[verdict.modelOutcome]
			: undefined;
	if (limited) return limited;

	const recorded = await recordArrival(deps, {
		account,
		messageId: message.messageId,
		gate,
		classifierVerdict:
			consulted.state === "Answered" ? consulted.verdict : { kind: "None" },
		spamPlacement: spam.placement,
		placement:
			input.move && !cleared
				? {
						row: message,
						roles: await deps.roles(account.accountId),
						sender,
						move: true,
						leaveJunk: true,
					}
				: undefined,
		headerCategory: classification.category,
	});
	await deps.message.update(message.messageId, {
		...classification,
		category: recorded.category,
		classificationState: MessageClassificationState.Examined,
		...(consulted.state === "Answered"
			? { classifierScores: consulted.scores }
			: {}),
		spamVerdict: verdict,
		...recorded.placementUpdate,
	});
	return { state: "Recorded", verdict, labels: recorded.labels };
};
