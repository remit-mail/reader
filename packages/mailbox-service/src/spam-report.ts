import type {
	IAddressRepository,
	IMailboxSpecialUseRepository,
	IMessageRepository,
} from "@remit/data-ports";
import { AddressRole, MessageKeywordFlag } from "@remit/domain-enums";
import type { FlagPushService } from "./flag-push.js";
import type { MessageMoveService } from "./message-move.js";

export interface SpamReportLogger {
	info(obj: Record<string, unknown>, msg: string): void;
	error(obj: Record<string, unknown>, msg: string): void;
}

const noopLogger: SpamReportLogger = {
	info: () => {},
	error: () => {},
};

export interface SpamReportConfig {
	messageService: IMessageRepository;
	addressService: IAddressRepository;
	mailboxSpecialUseService: IMailboxSpecialUseRepository;
	messageMoveService: MessageMoveService;
	flagPushService: FlagPushService;
	logger?: SpamReportLogger;
}

export interface SpamReportParams {
	accountConfigId: string;
	accountId: string;
	messageId: string;
	setBy?: string;
}

/**
 * Collapses the old separate `Block` (Address.flags.blocked, no move) and
 * `Mark spam` (move to Junk, no memory) actions into one: report-spam does
 * both, not-spam undoes both. One user intent, one failure story, one place
 * for the mutator ordering — RFC/issue background in the PR description.
 *
 * Ordering (docs/architecture/imap-mutations.md R2 — RECONCILE, not WAIT):
 * the sender-level `blocked` flag is an ordinary write with no dependency on
 * IMAP state — it references nothing the server produces (no folder id, no
 * UID, no normalized path), so nothing about it can go dangling when the move
 * settles later, or never. It is written FIRST and unconditionally; the move
 * that follows is the IMAP mutation (mutator pattern: `MessageMoveService`
 * already does local-pending-write + enqueue), and a failed or delayed move
 * never rolls the flag back — a transient IMAP failure must not silently
 * discard the user's stated intent to block this sender.
 *
 * Idempotent under a repeated call: `mergeFlags` re-sets the same value,
 * `MessageMoveService.moveMessage`/`restoreMessage` no-op once the local
 * `mailboxId` already equals the target (its own pre-existing same-mailbox
 * guard), and `FlagPushService.flip` replaces its marker rather than
 * duplicating it.
 */
export class SpamReportService {
	private messageService: IMessageRepository;
	private addressService: IAddressRepository;
	private mailboxSpecialUseService: IMailboxSpecialUseRepository;
	private messageMoveService: MessageMoveService;
	private flagPushService: FlagPushService;
	private log: SpamReportLogger;

	constructor(config: SpamReportConfig) {
		this.messageService = config.messageService;
		this.addressService = config.addressService;
		this.mailboxSpecialUseService = config.mailboxSpecialUseService;
		this.messageMoveService = config.messageMoveService;
		this.flagPushService = config.flagPushService;
		this.log = config.logger ?? noopLogger;
	}

	private resolveFromAddressId = async (messageId: string): Promise<string> => {
		const description = await this.messageService.describe(messageId);
		const from = description.envelopeAddress.find(
			(a) => a.addressRole === AddressRole.From,
		);
		if (!from) {
			throw new Error(`Message ${messageId} has no From address to act on`);
		}
		return from.addressId;
	};

	reportSpam = async (params: SpamReportParams): Promise<void> => {
		const { accountConfigId, accountId, messageId, setBy } = params;
		const now = Date.now();

		const addressId = await this.resolveFromAddressId(messageId);

		// Durable the instant this write lands — see class docstring (R2:
		// reconcile, not wait). Set before the move is even attempted.
		await this.addressService.mergeFlags(accountConfigId, addressId, {
			blocked: { value: true, setAt: now, setBy, reason: "reported-spam" },
		});

		const junkMailbox =
			await this.mailboxSpecialUseService.findJunkMailbox(accountId);
		if (!junkMailbox) {
			throw new Error(`No Junk mailbox found for account ${accountId}`);
		}

		// IMAP mutation. No catch here: a failed move must fail loudly and must
		// never roll back the blocked flag just written above.
		await this.messageMoveService.moveMessage(
			accountConfigId,
			messageId,
			junkMailbox.mailboxId,
			accountId,
		);

		await this.flagPushService.flip({
			accountId,
			accountConfigId,
			messageId,
			mailboxId: junkMailbox.mailboxId,
			flagName: MessageKeywordFlag.Junk,
			operation: "add",
		});

		await this.messageService.update(messageId, {
			spamReport: { reportedAt: now },
		});

		this.log.info(
			{ accountId, messageId, addressId, junkMailboxId: junkMailbox.mailboxId },
			"Reported message as spam",
		);
	};

	notSpam = async (params: SpamReportParams): Promise<void> => {
		const { accountConfigId, accountId, messageId } = params;

		const addressId = await this.resolveFromAddressId(messageId);

		// Clears the block ONLY — never promotes the sender to trusted/wellknown.
		// One undo press is thin evidence for trust.
		await this.addressService.mergeFlags(accountConfigId, addressId, {
			blocked: null,
		});

		// IMAP mutation. No catch: a failed restore must fail loudly and must
		// never roll back the flag clear above.
		await this.messageMoveService.restoreMessage(
			accountConfigId,
			messageId,
			accountId,
		);

		const message = await this.messageService.get(messageId);

		await this.flagPushService.flip({
			accountId,
			accountConfigId,
			messageId,
			mailboxId: message.mailboxId,
			flagName: MessageKeywordFlag.Junk,
			operation: "remove",
		});
		await this.flagPushService.flip({
			accountId,
			accountConfigId,
			messageId,
			mailboxId: message.mailboxId,
			flagName: MessageKeywordFlag.NotJunk,
			operation: "add",
		});

		await this.messageService.clearSpamReport(messageId);

		this.log.info({ accountId, messageId, addressId }, "Undid spam report");
	};
}
