import type {
	IAccountRepository,
	IAddressRepository,
	IMailboxSpecialUseRepository,
	IMessageRepository,
} from "@remit/data-ports";
import {
	AddressRole,
	MessageKeywordFlag,
	MessageStatus,
	MessageSyncStatus,
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

export interface SpamReportConfig {
	messageService: IMessageRepository;
	addressService: IAddressRepository;
	accountService: IAccountRepository;
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

export class SpamReportService {
	private messageService: IMessageRepository;
	private addressService: IAddressRepository;
	private accountService: IAccountRepository;
	private mailboxSpecialUseService: IMailboxSpecialUseRepository;
	private messageMoveService: MessageMoveService;
	private flagPushService: FlagPushService;
	private log: SpamReportLogger;

	constructor(config: SpamReportConfig) {
		this.messageService = config.messageService;
		this.addressService = config.addressService;
		this.accountService = config.accountService;
		this.mailboxSpecialUseService = config.mailboxSpecialUseService;
		this.messageMoveService = config.messageMoveService;
		this.flagPushService = config.flagPushService;
		this.log = config.logger ?? noopLogger;
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

		if (message.syncStatus === MessageSyncStatus.failed) {
			// The move to Junk never reached the server (its retries exhausted) —
			// the server still has the message at `originalMailboxId`. Repair the
			// local optimistic write directly instead of calling `restoreMessage`,
			// which would enqueue a second, bogus IMAP move for a message that
			// never left its original folder.
			if (message.originalMailboxId) {
				await this.messageService.updateForMove(messageId, {
					mailboxId: message.originalMailboxId,
					status: MessageStatus.active,
					syncStatus: MessageSyncStatus.synced,
				});
			}
		} else if (message.originalMailboxId) {
			await this.messageMoveService.restoreMessage(
				accountConfigId,
				messageId,
				accountId,
			);
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
