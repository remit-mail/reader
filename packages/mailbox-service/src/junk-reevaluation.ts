import type {
	IAddressRepository,
	IMailboxRepository,
	IMailboxSpecialUseRepository,
	IMessageRepository,
	MessageItem,
} from "@remit/data-ports";
import {
	isStorageNotFoundError,
	type StorageService,
} from "@remit/storage-service";
import type { ParsedMail } from "mailparser";
import { BodyParseError, parseMessageBody } from "./body-parse.js";
import {
	type ClassifierConfig,
	readClassifierGate,
} from "./classifier/classifier-gate.js";
import { extractPrimaryFromEmail } from "./classify-message.js";
import { type JunkBacklogAccount, junkBacklogOf } from "./junk-backlog-due.js";
import { type PlaceMessageDeps, placeMessage } from "./place-message.js";
import { readSenderPlacement } from "./sender-placement.js";

export const JUNK_BACKLOG_BATCH = 25;

export interface JunkBacklogLogger {
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
		"listUndecidedJunkBacklog" | "update"
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
	message: MessageItem,
	bodyStorageKey: string,
): Promise<ParsedMail | undefined> =>
	deps.storageService
		.retrieve(bodyStorageKey)
		.then(parseMessageBody)
		.catch((error: unknown) => {
			if (!isUnreadableBody(error)) throw error;
			deps.log.warn(
				{ messageId: message.messageId, error },
				"Junk re-evaluation passed over an unreadable stored body",
			);
			return undefined;
		});

// Wait, not reconcile (imap-mutations R2/R3): a move binds to the settled row and skips a message that left Junk.
export const reevaluateJunkBacklog = async (
	deps: JunkBacklogDeps,
	account: JunkBacklogAccount,
	now: number,
): Promise<JunkBacklogResult> => {
	const result: JunkBacklogResult = { outcome: "Done", examined: 0, moved: 0 };
	const backlog = await junkBacklogOf(
		deps,
		account.accountId,
		JUNK_BACKLOG_BATCH,
	);
	if (!backlog || backlog.messages.length === 0) return result;

	const roles = {
		junkMailbox: backlog.junk,
		inboxMailbox: await deps.mailboxSpecialUseService.findInboxMailbox(
			account.accountId,
		),
	};
	const gate = await readClassifierGate(
		deps.classifierConfig,
		account.accountConfigId,
	);

	for (const message of backlog.messages) {
		const parsed = message.bodyStorageKey
			? await readBody(deps, message, message.bodyStorageKey)
			: undefined;
		if (!parsed) {
			await deps.messageService.update(message.messageId, {
				placementDecidedAt: now,
			});
			continue;
		}
		const placed = await placeMessage(deps, {
			account,
			message,
			placement: "junk",
			roles,
			sender: () =>
				readSenderPlacement(
					deps.addressService,
					account.accountConfigId,
					extractPrimaryFromEmail(parsed),
				),
			classifier: {
				state: "Ask",
				config: deps.classifierConfig,
				gate,
				parsed,
			},
			move: true,
			now,
		});
		if (placed.state === "AtLimit") return { ...result, outcome: "AtLimit" };
		result.examined += 1;
		if (placed.state === "Skipped") continue;
		await deps.messageService.update(message.messageId, placed.update);
		if (placed.update.movedByRemit) result.moved += 1;
	}
	return result;
};
