import type {
	IMailboxSpecialUseRepository,
	MessageItem,
	UpdateMessageInput,
} from "@remit/data-ports";
import type { ParsedMail } from "mailparser";
import { consultClassifier } from "./classifier/classifier-consult.js";
import type {
	ClassifierConfig,
	ClassifierGate,
} from "./classifier/classifier-gate.js";
import type { FolderRoleMailboxes } from "./folder-placement.js";
import {
	decidePlacement,
	type FolderPlacement,
	placementVerdictRecord,
} from "./heuristics/classifyPlacement.js";
import type { PlacementMoveService } from "./placement-move.js";
import type { SenderPlacement } from "./sender-placement.js";

export interface PlaceMessageDeps {
	mailboxSpecialUseService: Pick<
		IMailboxSpecialUseRepository,
		"findArchiveMailbox"
	>;
	placementMoveService: Pick<PlacementMoveService, "moveMessage">;
	log: { info(obj: Record<string, unknown>, msg: string): void };
}

export type PlacementClassifier =
	| { state: "Judged"; junk: boolean }
	| {
			state: "Ask";
			config: ClassifierConfig;
			gate: ClassifierGate;
			parsed: ParsedMail;
	  };

export interface PlaceMessageInput {
	account: { accountId: string; accountConfigId: string };
	message: MessageItem;
	placement: FolderPlacement;
	roles: FolderRoleMailboxes;
	sender: () => Promise<SenderPlacement>;
	classifier: PlacementClassifier;
	move: boolean;
	now: number;
}

export type PlacementUpdate = Pick<
	UpdateMessageInput,
	"placementDecidedAt" | "placementVerdict" | "movedByRemit"
>;

export type PlaceMessageResult =
	| { state: "AtLimit" }
	| { state: "Skipped" }
	| { state: "Decided"; update: PlacementUpdate };

type ClassifierJunk = boolean | "AtLimit";

const classifierJunkOf = async (
	classifier: PlacementClassifier,
	account: PlaceMessageInput["account"],
	sender: SenderPlacement,
	now: number,
): Promise<ClassifierJunk> => {
	if (classifier.state === "Judged") return classifier.junk;
	const consulted = await consultClassifier(
		classifier.config,
		classifier.gate,
		account,
		classifier.parsed,
		sender.senderOverride,
		now,
	);
	if (consulted.state === "AtLimit") return "AtLimit";
	return consulted.state === "Answered" && consulted.verdict.kind === "Junk";
};

export const placeMessage = async (
	deps: PlaceMessageDeps,
	input: PlaceMessageInput,
): Promise<PlaceMessageResult> => {
	const { account, message, placement, roles, now } = input;
	const sender = await input.sender();
	const classifierJunk = await classifierJunkOf(
		input.classifier,
		account,
		sender,
		now,
	);
	if (classifierJunk === "AtLimit") return { state: "AtLimit" };

	const archiveMailbox = sender.autoArchive
		? await deps.mailboxSpecialUseService.findArchiveMailbox(account.accountId)
		: null;
	const decision = decidePlacement(
		message,
		placement,
		sender.senderTrust,
		sender.senderOverride,
		classifierJunk,
		archiveMailbox !== null,
	);
	const record = placementVerdictRecord(decision, placement, now);
	const decided: PlacementUpdate = {
		placementDecidedAt: now,
		...(record ? { placementVerdict: record } : {}),
	};

	const { verdict, destination } = decision;
	const target =
		destination === undefined
			? null
			: {
					inbox: roles.inboxMailbox,
					junk: roles.junkMailbox,
					archive: archiveMailbox,
				}[destination];
	if (!input.move || !target || target.mailboxId === message.mailboxId) {
		return { state: "Decided", update: decided };
	}

	deps.log.info(
		{
			messageId: message.messageId,
			accountId: account.accountId,
			placement,
			action: verdict.action,
			confidence: verdict.confidence,
			reasons: verdict.reasons,
			destination,
			destinationMailboxId: target.mailboxId,
		},
		"Placement verdict",
	);
	const outcome = await deps.placementMoveService.moveMessage(
		account.accountConfigId,
		message.messageId,
		target.mailboxId,
		account.accountId,
		message.mailboxId,
	);
	if (outcome !== "filed") return { state: "Skipped" };
	return { state: "Decided", update: { ...decided, movedByRemit: true } };
};
