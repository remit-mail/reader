import type {
	IAccountRepository,
	IAddressRepository,
	IMailboxSpecialUseRepository,
	IMessageRepository,
	MessageItem,
	SenderNeverSpamBackApplyEvent,
} from "@remit/data-ports";
import { deriveAddressId } from "@remit/data-ports/id";
import { AddressRole, MessageKeywordFlag } from "@remit/domain-enums";
import type { FlagPushService } from "./flag-push.js";
import type { MessageMoveService } from "./message-move.js";

export interface SpamReportLogger {
	info(obj: Record<string, unknown>, msg: string): void;
	error(obj: Record<string, unknown>, msg: string): void;
}

/**
 * The account advertises no Junk folder and has none under any conventional
 * name, so there is nowhere to file the report. A designed, user-facing
 * outcome — the user has to create the folder, and no amount of retrying
 * changes that — so it carries its own text through the bulk handler's
 * allowlist rather than being flattened to the generic retry copy.
 */
export class NoJunkMailboxError extends Error {
	constructor() {
		super(
			"This account has no Junk folder. Create one named Junk or Spam in your mail provider, then report this message again.",
		);
		this.name = "NoJunkMailboxError";
	}
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

export type NeverSpamGrant = Omit<SenderNeverSpamBackApplyEvent, "type">;

export interface SpamReportParams {
	accountConfigId: string;
	accountId: string;
	messageId: string;
	setBy: string;
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

	/**
	 * The sender to act on. `addressId` is derived rather than read off the
	 * envelope row so it always names the row `ensureSenderAddress` writes and
	 * the harvester writes — one derivation, one row, whatever the envelope
	 * happens to carry.
	 */
	private resolveFromAddress = async (
		accountConfigId: string,
		messageId: string,
	): Promise<{
		addressId: string;
		normalizedEmail: string;
		displayName: string;
	}> => {
		const description = await this.messageService.describe(messageId);
		const from = description.envelopeAddress.find(
			(a) => a.addressRole === AddressRole.From,
		);
		if (!from) {
			throw new Error(`Message ${messageId} has no From address to act on`);
		}
		return {
			addressId: deriveAddressId(accountConfigId, from.normalizedEmail),
			normalizedEmail: from.normalizedEmail,
			displayName: from.displayName ?? "",
		};
	};

	/**
	 * The list form answers `[]` for a row that is not there, where the single
	 * form throws — absence is a case both callers handle, not a fault.
	 */
	private senderIsKnown = async (
		accountConfigId: string,
		addressId: string,
	): Promise<boolean> => {
		const [known] = await this.addressService.getAddress(accountConfigId, [
			addressId,
		]);
		return known !== undefined;
	};

	/**
	 * Blocking a sender owns the row it writes to. Harvesting is what ordinarily
	 * creates it, but a message whose harvest never landed — or whose row was
	 * taken by a cascade — still has a sender the user is entitled to block, and
	 * a missing row used to abort report-spam before the message ever reached
	 * Junk. The id is the harvester's own derivation, so this converges on the
	 * one row rather than minting a parallel one.
	 *
	 * A row that already exists is left exactly as it stands. Reporting spam is
	 * evidence about the sender, never about the account's standing record of
	 * them: an upsert here would carry whatever the upsert path does on
	 * conflict — today a display name chosen by the spammer, and any flag a
	 * later sighting-clearing rule hangs off it — into an operation that means
	 * the opposite.
	 */
	private ensureSenderAddress = async (
		accountConfigId: string,
		from: { addressId: string; normalizedEmail: string; displayName: string },
	): Promise<void> => {
		const separator = from.normalizedEmail.lastIndexOf("@");
		const localPart = from.normalizedEmail.slice(0, separator);
		const domain = from.normalizedEmail.slice(separator + 1);
		if (separator < 0 || localPart.length === 0 || domain.length === 0) {
			throw new Error(
				`Sender address ${from.normalizedEmail} is not a usable email address`,
			);
		}
		if (await this.senderIsKnown(accountConfigId, from.addressId)) return;
		await this.addressService.upsertAddress({
			addressId: from.addressId,
			accountConfigId,
			localPart,
			domain,
			normalizedEmail: from.normalizedEmail,
			normalizedCompound:
				`${from.displayName.toLowerCase()} ${from.normalizedEmail}`.trim(),
			displayName: from.displayName,
		});
	};

	reportSpam = async (params: SpamReportParams): Promise<void> => {
		const { accountConfigId, accountId, messageId, setBy } = params;
		const now = Date.now();

		// Resolved before anything is written: with nowhere to file the report,
		// the operation cannot happen, and a blocked sender plus a `spamReport`
		// stamp on a message still sitting in the inbox is a report that half
		// happened. Fail here and the press changed nothing.
		const junkMailbox =
			await this.mailboxSpecialUseService.findJunkMailbox(accountId);
		if (!junkMailbox) {
			this.log.error({ accountId, messageId }, "No Junk mailbox for account");
			throw new NoJunkMailboxError();
		}

		const from = await this.resolveFromAddress(accountConfigId, messageId);
		const account = await this.accountService.get(accountId);
		const isOwnAddress =
			from.normalizedEmail.toLowerCase() === account.email.toLowerCase();

		if (!isOwnAddress) {
			await this.ensureSenderAddress(accountConfigId, from);
			await this.addressService.mergeFlags(accountConfigId, from.addressId, {
				blocked: { value: true, setAt: now, setBy },
			});
		}

		// Captured before this call writes anything: `before.spamReport` tells
		// apart the two reasons the message can already be in Junk. If it is
		// already set, a PREVIOUS report-spam press put it there and owns
		// `originalMailboxId` — that value is exactly what Undo needs and must
		// survive a repeated press. Only when it is absent is the message in
		// Junk for some unrelated reason (a provider filter, a manual move),
		// making any `originalMailboxId` on the row stale.
		const before = await this.messageService.get(messageId);
		const hadSpamReportAlready = Boolean(before.spamReport);

		await this.messageService.update(messageId, {
			spamReport: { reportedAt: now },
		});

		const alreadyInJunk = before.mailboxId === junkMailbox.mailboxId;

		await this.messageMoveService.moveMessage(
			accountConfigId,
			messageId,
			junkMailbox.mailboxId,
			accountId,
			before.mailboxId,
		);

		if (alreadyInJunk && before.originalMailboxId && !hadSpamReportAlready) {
			// moveMessage's same-mailbox guard no-opped — it never touches
			// originalMailboxId, so a stale value left by some earlier, unrelated
			// move would otherwise survive and send a later notSpam to the wrong
			// folder. This report-spam action established no move of its own.
			//
			// A transition off the row this call read (imap-mutations R3): the pair
			// being cleared belongs to a placement, and a lane that has claimed the
			// row since keeps its own — its settle manages the pair.
			await this.messageService.transitionPlacement(
				messageId,
				{
					status: before.status,
					mailboxId: before.mailboxId,
					uid: before.uid,
				},
				{ originalMailboxId: null, originalUid: null },
			);
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

	notSpam = async (
		params: SpamReportParams,
	): Promise<NeverSpamGrant | undefined> => {
		const { accountConfigId, accountId, messageId, setBy } = params;

		const from = await this.resolveFromAddress(accountConfigId, messageId);
		if (await this.senderIsKnown(accountConfigId, from.addressId)) {
			await this.addressService.mergeFlags(accountConfigId, from.addressId, {
				blocked: null,
			});
		}

		const message = await this.messageService.get(messageId);
		const overrulesJunkVerdict =
			!message.spamReport && (await this.isInJunk(message, accountId));
		const destinationMailboxId = await this.notSpamDestination(
			message,
			overrulesJunkVerdict,
			accountId,
		);

		if (destinationMailboxId) {
			await this.messageMoveService.moveMessage(
				accountConfigId,
				messageId,
				destinationMailboxId,
				accountId,
				message.mailboxId,
			);

			// Re-read, then clear against what was read. The move just wrote a
			// placement, so the row here is not the one above; predicating on it is
			// what keeps this from erasing a pair some other lane is relying on
			// (imap-mutations R3).
			const moved = await this.messageService.get(messageId);
			await this.messageService.transitionPlacement(
				messageId,
				{
					status: moved.status,
					mailboxId: moved.mailboxId,
					uid: moved.uid,
				},
				{ originalMailboxId: null, originalUid: null },
			);
		}

		const grant = overrulesJunkVerdict
			? await this.grantNeverSpam(accountConfigId, accountId, from, setBy)
			: undefined;

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
		return grant;
	};

	private isInJunk = async (
		message: MessageItem,
		accountId: string,
	): Promise<boolean> => {
		const junkMailbox =
			await this.mailboxSpecialUseService.findJunkMailbox(accountId);
		return junkMailbox?.mailboxId === message.mailboxId;
	};

	private notSpamDestination = async (
		message: MessageItem,
		overrulesJunkVerdict: boolean,
		accountId: string,
	): Promise<string | undefined> => {
		if (message.originalMailboxId) return message.originalMailboxId;
		if (!overrulesJunkVerdict) return undefined;
		const inboxMailbox =
			await this.mailboxSpecialUseService.findInboxMailbox(accountId);
		if (!inboxMailbox) {
			throw new Error(
				`Account ${accountId} has no Inbox to move ${message.messageId}`,
			);
		}
		return inboxMailbox.mailboxId;
	};

	private grantNeverSpam = async (
		accountConfigId: string,
		accountId: string,
		from: { addressId: string; normalizedEmail: string; displayName: string },
		setBy: string,
	): Promise<NeverSpamGrant | undefined> => {
		const account = await this.accountService.get(accountId);
		if (from.normalizedEmail.toLowerCase() === account.email.toLowerCase()) {
			return undefined;
		}
		await this.ensureSenderAddress(accountConfigId, from);
		await this.addressService.mergeFlags(accountConfigId, from.addressId, {
			neverSpam: { value: true, setAt: Date.now(), setBy },
		});
		return {
			accountConfigId,
			addressId: from.addressId,
			normalizedEmail: from.normalizedEmail,
		};
	};
}
