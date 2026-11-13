import type {
	ClassifierScoreItem,
	MessageItem,
	MessageSpamVerdict,
	UpdateMessageInput,
} from "@remit/data-ports";
import { MessageClassificationState } from "@remit/domain-enums";
import type { ParsedMail } from "mailparser";
import { ensureLabel } from "./classification-labels.js";
import type {
	ClassifierConfig,
	ClassifierGate,
} from "./classifier/classifier-gate.js";
import {
	type ClassifierVerdict,
	classificationLabelOf,
} from "./classifier/classifier-precedence.js";
import {
	extractPrimaryFromEmail,
	type ParsedMessageClassification,
} from "./classify-message.js";
import type { FilterDecision } from "./filters/pipeline.js";
import { type FolderRoleMailboxes, placementOf } from "./folder-placement.js";
import {
	hasDecidedCategory,
	type MessageCategoryValue,
} from "./message-category.js";
import {
	type PlaceMessageDeps,
	type PlacementUpdate,
	placeMessage,
} from "./place-message.js";
import type { SenderPlacement } from "./sender-placement.js";
import {
	type SpamArrival,
	type SpamConfig,
	type SpamPlacement,
	spamModelAccessOf,
} from "./spam/index.js";

type Account = { accountId: string; accountConfigId: string };
type Classification = ParsedMessageClassification["fields"];

/** The spam check's input for one message, as body sync and rescan send it. */
export const spamArrivalOf = (input: {
	account: Account;
	parsed: ParsedMail;
	raw: Buffer;
	internalDate: number;
	sender: SenderPlacement;
	filterDecision: FilterDecision;
	classifierScores: ClassifierScoreItem[];
	classification: Classification;
	classifier: ClassifierConfig | undefined;
	gate: ClassifierGate;
	ownAddresses: string[];
}): SpamArrival => ({
	accountConfigId: input.account.accountConfigId,
	fromEmail: extractPrimaryFromEmail(input.parsed),
	rcpt: input.ownAddresses,
	parsed: input.parsed,
	raw: input.raw,
	internalDate: input.internalDate,
	sender: input.sender,
	filterDecision: input.filterDecision,
	classifierScores: input.classifierScores,
	model: spamModelAccessOf(input.classifier, input.gate, input.account),
	hasListUnsubscribe: input.classification.hasListUnsubscribe ?? false,
	dmarc: input.classification.authResult?.dmarc,
});

export interface ArrivalPlacement {
	deps: PlaceMessageDeps;
	row: MessageItem;
	roles: FolderRoleMailboxes;
	sender: SenderPlacement;
	move: boolean;
	leaveJunk: boolean;
}

export interface ArrivalRecordInput {
	account: Account;
	messageId: string;
	gate: () => Promise<ClassifierGate>;
	classifierVerdict: ClassifierVerdict;
	classifierScores: ClassifierScoreItem[];
	classification: Classification;
	currentCategory: MessageCategoryValue;
	spamVerdict: MessageSpamVerdict;
	spamPlacement: SpamPlacement;
	placement: ArrivalPlacement | undefined;
}

const place = async (
	input: ArrivalRecordInput,
	placement: ArrivalPlacement,
): Promise<PlacementUpdate> => {
	const folder = placementOf(placement.row.mailboxId, placement.roles);
	if (folder === "junk" && placement.leaveJunk) return {};
	const placed = await placeMessage(placement.deps, {
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
 * and the Message update. `category` is write-once (RFC 034 D3.1): a decided
 * one, or a `flags.category` override, wins over the recomputed one. The
 * label rides on the messageId, which a placement move keeps, so it neither
 * waits for the move to settle nor needs reconciling after it.
 */
export const recordArrival = async (
	spam: Pick<SpamConfig, "labelService" | "messageLabelService">,
	input: ArrivalRecordInput,
): Promise<{
	update: UpdateMessageInput & { category: MessageCategoryValue };
	labels: string[];
}> => {
	const { account, messageId, gate, classifierVerdict } = input;
	const placementUpdate = input.placement
		? await place(input, input.placement)
		: {};

	const classifierLabel = classificationLabelOf(classifierVerdict);
	const classifierGate = classifierLabel ? await gate() : undefined;
	const labels = [
		...(classifierLabel && classifierGate?.state === "On"
			? [classifierGate.labels[classifierLabel]]
			: []),
		...(input.spamPlacement.action === "None"
			? []
			: [
					await ensureLabel(
						spam.labelService,
						account.accountConfigId,
						input.spamPlacement.label,
					),
				]),
	];
	for (const label of labels) {
		await spam.messageLabelService.apply({
			messageId,
			labelId: label.labelId,
			accountConfigId: account.accountConfigId,
		});
	}

	return {
		update: {
			...input.classification,
			category: hasDecidedCategory(input.currentCategory)
				? input.currentCategory
				: classifierVerdict.kind === "Category"
					? classifierVerdict.category
					: input.classification.category,
			classificationState: MessageClassificationState.Examined,
			classifierScores: input.classifierScores,
			spamVerdict: input.spamVerdict,
			...placementUpdate,
		},
		labels: labels.map((label) => label.name),
	};
};
