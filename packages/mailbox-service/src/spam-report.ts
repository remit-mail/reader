import type {
	IAccountRepository,
	IAddressRepository,
	IMailboxSpecialUseRepository,
	IMessageRepository,
	MessageItem,
} from "@remit/data-ports";
import {
	AddressRole,
	MessageKeywordFlag,
	MessageStatus,
} from "@remit/domain-enums";
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

const DEFAULT_MOVE_SETTLE_TIMEOUT_MS = 5_000;
const DEFAULT_MOVE_SETTLE_POLL_MS = 250;

export interface SpamReportConfig {
	messageService: IMessageRepository;
	addressService: IAddressRepository;
	accountService: IAccountRepository;
	mailboxSpecialUseService: IMailboxSpecialUseRepository;
	messageMoveService: MessageMoveService;
	flagPushService: FlagPushService;
	logger?: SpamReportLogger;
	/** How long `notSpam` waits for a still-in-flight move before giving up. */
	moveSettleTimeoutMs?: number;
	moveSettlePollMs?: number;
}

export interface SpamReportParams {
	accountConfigId: string;
	accountId: string;
	messageId: string;
	setBy?: string;
}

export class SpamReportService {
	private messageService: IMessageRepository;
	private addressService: IAddressRepository;
	private accountService: IAccountRepository;
	private mailboxSpecialUseService: IMailboxSpecialUseRepository;
	private messageMoveService: MessageMoveService;
	private flagPushService: FlagPushService;
	private log: SpamReportLogger;
	private moveSettleTimeoutMs: number;
	private moveSettlePollMs: number;

	constructor(config: SpamReportConfig) {
		this.messageService = config.messageService;
		this.addressService = config.addressService;
		this.accountService = config.accountService;
		this.mailboxSpecialUseService = config.mailboxSpecialUseService;
		this.messageMoveService = config.messageMoveService;
		this.flagPushService = config.flagPushService;
		this.log = config.logger ?? noopLogger;
		this.moveSettleTimeoutMs =
			config.moveSettleTimeoutMs ?? DEFAULT_MOVE_SETTLE_TIMEOUT_MS;
		this.moveSettlePollMs =
			config.moveSettlePollMs ?? DEFAULT_MOVE_SETTLE_POLL_MS;
	}

	private resolveFromAddress = async (
		messageId: string,
	): Promise<{ addressId: string; normalizedEmail: string }> => {
		const description = await this.messageService.describe(messageId);
		const from = description.envelopeAddress.find(
			(a) => a.addressRole === AddressRole.From,
		);
		if (!from) {
			throw new Error(`Message ${messageId} has no From address to act on`);
		}
		return { addressId: from.addressId, normalizedEmail: from.normalizedEmail };
	};

	/**
	 * R2 wait (docs/architecture/imap-mutations.md): `notSpam`'s restore is a
	 * dependent write against report-spam's own move — enqueuing it while that
	 * move is still in flight (`status === moving`) would carry the message's
	 * pre-move `uid` (only a CONFIRMED move updates it, via `updateUid`) and
	 * risk acting on the wrong server-side message once both moves are
	 * in-flight at once. Cheap to block per the doc's default guidance: a move
	 * ordinarily settles in well under a second. On timeout the dependent
	 * write is not made — the caller is told to retry, and retrying is safe
	 * (this whole flow is idempotent).
	 */
	private waitForMoveToSettle = async (
		messageId: string,
	): Promise<MessageItem> => {
		const deadline = Date.now() + this.moveSettleTimeoutMs;
		let message = await this.messageService.get(messageId);
		while (message.status === MessageStatus.moving && Date.now() < deadline) {
			await new Promise((resolve) =>
				setTimeout(resolve, this.moveSettlePollMs),
			);
			message = await this.messageService.get(messageId);
		}
		return message;
	};

	reportSpam = async (params: SpamReportParams): Promise<void> => {
		const { accountConfigId, accountId, messageId, setBy } = params;
		const now = Date.now();

		const from = await this.resolveFromAddress(messageId);
		const account = await this.accountService.get(accountId);
		const isOwnAddress =
			from.normalizedEmail.toLowerCase() === account.email.toLowerCase();

		if (!isOwnAddress) {
			await this.addressService.mergeFlags(accountConfigId, from.addressId, {
				blocked: { value: true, setAt: now, setBy },
			});
		}

		await this.messageService.update(messageId, {
			spamReport: { reportedAt: now },
		});

		const junkMailbox =
			await this.mailboxSpecialUseService.findJunkMailbox(accountId);
		if (!junkMailbox) {
			throw new Error(`No Junk mailbox found for account ${accountId}`);
		}

		const before = await this.messageService.get(messageId);
		const alreadyInJunk = before.mailboxId === junkMailbox.mailboxId;

		await this.messageMoveService.moveMessage(
			accountConfigId,
			messageId,
			junkMailbox.mailboxId,
			accountId,
		);

		if (alreadyInJunk && before.originalMailboxId) {
			// moveMessage's same-mailbox guard no-opped — it never touches
			// originalMailboxId, so a stale value left by some earlier, unrelated
			// move would otherwise survive and send a later notSpam to the wrong
			// folder. This report-spam action established no move of its own.
			await this.messageService.clearOriginalMailboxId(messageId);
		}

		await this.flagPushService.flip({
			accountId,
			accountConfigId,
			messageId,
			mailboxId: junkMailbox.mailboxId,
			flagName: MessageKeywordFlag.Junk,
			operation: "add",
		});

		this.log.info(
			{
				accountId,
				messageId,
				addressId: from.addressId,
				junkMailboxId: junkMailbox.mailboxId,
				skippedBlock: isOwnAddress,
			},
			"Reported message as spam",
		);
	};

	notSpam = async (params: SpamReportParams): Promise<void> => {
		const { accountConfigId, accountId, messageId } = params;

		const from = await this.resolveFromAddress(messageId);
		await this.addressService.mergeFlags(accountConfigId, from.addressId, {
			blocked: null,
		});

		const message = await this.messageService.get(messageId);

		if (message.originalMailboxId) {
			// Only wait on the move's settlement when there is actually a
			// dependent write to make (the restore below) — a move in flight for
			// an unrelated reason is not this operation's concern.
			const settled = await this.waitForMoveToSettle(messageId);
			if (settled.status === MessageStatus.moving) {
				throw new Error(
					`Message ${messageId}'s move to Junk has not settled yet; try again in a moment.`,
				);
			}

			// Whatever state the move settled into, restoreMessage converges
			// correctly: a confirmed move to Junk gets a real Junk->INBOX move;
			// a move the imap-worker's own terminal resolver already reverted
			// back to the source (its retries exhausted) has mailboxId already
			// equal to originalMailboxId, so moveMessage's same-mailbox guard
			// no-ops.
			await this.messageMoveService.restoreMessage(
				accountConfigId,
				messageId,
				accountId,
			);
			await this.messageService.clearOriginalMailboxId(messageId);
		}

		const current = await this.messageService.get(messageId);

		await this.flagPushService.flip({
			accountId,
			accountConfigId,
			messageId,
			mailboxId: current.mailboxId,
			flagName: MessageKeywordFlag.Junk,
			operation: "remove",
		});
		await this.flagPushService.flip({
			accountId,
			accountConfigId,
			messageId,
			mailboxId: current.mailboxId,
			flagName: MessageKeywordFlag.NotJunk,
			operation: "add",
		});

		await this.messageService.clearSpamReport(messageId);

		this.log.info(
			{ accountId, messageId, addressId: from.addressId },
			"Undid spam report",
		);
	};
}
