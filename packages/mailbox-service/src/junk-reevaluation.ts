import type {
	IAddressRepository,
	IMailboxRepository,
	IMailboxSpecialUseRepository,
	IMessageRepository,
	MessageItem,
} from "@remit/data-ports";
import { MessageStatus } from "@remit/domain-enums";
import {
	isStorageNotFoundError,
	type StorageService,
} from "@remit/storage-service";
import type { ParsedMail } from "mailparser";
import { BodyParseError, parseMessageBody } from "./body-parse.js";
import { consultClassifier } from "./classifier/classifier-consult.js";
import {
	type ClassifierConfig,
	readClassifierGate,
} from "./classifier/classifier-gate.js";
import { extractPrimaryFromEmail } from "./classify-message.js";
import {
	type PlacementDecision,
	placementVerdictRecord,
} from "./heuristics/classifyPlacement.js";
import { type PlaceMessageDeps, placeMessage } from "./place-message.js";
import { readSenderPlacement } from "./sender-placement.js";

const JUNK_BACKLOG_BATCH = 25;

export interface JunkBacklogAccount {
	accountId: string;
	accountConfigId: string;
}

interface JunkBacklogLogger {
	info(obj: Record<string, unknown>, msg: string): void;
	warn(obj: Record<string, unknown>, msg: string): void;
}

export interface JunkBacklogDeps extends PlaceMessageDeps {
	mailboxSpecialUseService: Pick<
		IMailboxSpecialUseRepository,
		"findJunkMailbox" | "findInboxMailbox" | "findArchiveMailbox"
	>;
	mailboxService: Pick<IMailboxRepository, "get">;
	messageService: Pick<
		IMessageRepository,
		"listJunkBacklog" | "recordPlacementIf" | "update"
	>;
	addressService: Pick<IAddressRepository, "getAddress">;
	storageService: Pick<StorageService, "retrieve">;
	classifierConfig: ClassifierConfig;
	log: JunkBacklogLogger;
}

export interface JunkBacklogResult {
	outcome: "Done" | "AtLimit";
	examined: number;
	moved: number;
}

const isUnreadableBody = (error: unknown): boolean =>
	error instanceof BodyParseError || isStorageNotFoundError(error);

const readBody = (
	deps: JunkBacklogDeps,
	message: MessageItem & { bodyStorageKey: string },
): Promise<ParsedMail | undefined> =>
	deps.storageService
		.retrieve(message.bodyStorageKey)
		.then(parseMessageBody)
		.catch((error: unknown) => {
			if (!isUnreadableBody(error)) throw error;
			deps.log.warn(
				{ messageId: message.messageId, error },
				"Junk re-evaluation passed over an unreadable stored body",
			);
			return undefined;
		});

const UNREADABLE_BODY: PlacementDecision = {
	verdict: {
		action: "move-to-junk",
		confidence: "unsure",
		reasons: ["body-unreadable"],
	},
	destination: undefined,
};

// Wait, not reconcile (imap-mutations R2/R3): a move binds to the settled row and skips a message that left Junk.
const runJunkBacklog = async (
	deps: JunkBacklogDeps,
	account: JunkBacklogAccount,
	now: number,
): Promise<JunkBacklogResult> => {
	const result: JunkBacklogResult = { outcome: "Done", examined: 0, moved: 0 };
	const junk = await deps.mailboxSpecialUseService.findJunkMailbox(
		account.accountId,
	);
	if (!junk) return result;
	const junkFolder = await deps.mailboxService.get(
		account.accountId,
		junk.mailboxId,
	);
	const backlog = await deps.messageService.listJunkBacklog(
		junk.mailboxId,
		junkFolder.createdAt,
		JUNK_BACKLOG_BATCH,
	);
	if (backlog.length === 0) return result;

	const roles = {
		junkMailbox: junk,
		inboxMailbox: await deps.mailboxSpecialUseService.findInboxMailbox(
			account.accountId,
		),
	};
	const gate = await readClassifierGate(
		deps.classifierConfig,
		account.accountConfigId,
	);
	const stillInJunk = (message: MessageItem) => ({
		status: MessageStatus.active,
		mailboxId: message.mailboxId,
	});

	for (const message of backlog) {
		const parsed = await readBody(deps, message);
		if (!parsed) {
			await deps.messageService.recordPlacementIf(
				message.messageId,
				stillInJunk(message),
				{
					placementDecidedAt: now,
					placementVerdict: placementVerdictRecord(
						UNREADABLE_BODY,
						"junk",
						now,
					),
				},
			);
			continue;
		}
		const sender = await readSenderPlacement(
			deps.addressService,
			account.accountConfigId,
			extractPrimaryFromEmail(parsed),
		);
		const consulted = await consultClassifier(
			deps.classifierConfig,
			gate,
			account,
			parsed,
			sender.senderOverride,
			now,
		);
		if (consulted.state === "AtLimit") return { ...result, outcome: "AtLimit" };
		const placed = await placeMessage(deps, {
			account,
			message,
			placement: "junk",
			roles,
			sender,
			classifierJunk:
				consulted.state === "Answered" && consulted.verdict.kind === "Junk",
			move: true,
			now,
		});
		result.examined += 1;
		if (placed.state === "Skipped") continue;
		if (!placed.update.movedByRemit) {
			await deps.messageService.recordPlacementIf(
				message.messageId,
				stillInJunk(message),
				placed.update,
			);
			continue;
		}
		await deps.messageService.update(message.messageId, placed.update);
		result.moved += 1;
	}
	return result;
};

export const reevaluateJunkBacklog = async (
	deps: JunkBacklogDeps,
	account: JunkBacklogAccount,
	now: number,
): Promise<JunkBacklogResult> => {
	const result = await runJunkBacklog(deps, account, now);
	deps.log.info(
		{
			accountId: account.accountId,
			outcome: result.outcome,
			examined: result.examined,
			moved: result.moved,
		},
		"Junk re-evaluation delivery finished",
	);
	return result;
};
