import type {
	IAccountRepository,
	IAddressRepository,
	IMailboxSpecialUseRepository,
	IMessageRepository,
	SenderNeverSpamBackApplyEvent,
} from "@remit/data-ports";
import {
	type PlacementDecision,
	placementVerdictRecord,
} from "./heuristics/classifyPlacement.js";
import type { PlacementMoveService } from "./placement-move.js";

const NEVER_SPAM_BACKAPPLY_LIMIT = 500;

export interface NeverSpamBackApplyDeps {
	accountService: Pick<IAccountRepository, "listMailSourcesByAccountConfig">;
	addressService: Pick<IAddressRepository, "getAddress">;
	mailboxSpecialUseService: Pick<
		IMailboxSpecialUseRepository,
		"findJunkMailbox" | "findInboxMailbox"
	>;
	messageService: Pick<IMessageRepository, "listSenderJunk" | "update">;
	placementMoveService: Pick<PlacementMoveService, "moveMessage">;
}

export interface NeverSpamBackApplyResult {
	outcome: "Done" | "FlagCleared";
	moved: number;
	skipped: number;
}

const neverSpamStands = async (
	deps: NeverSpamBackApplyDeps,
	event: SenderNeverSpamBackApplyEvent,
): Promise<boolean> => {
	const [address] = await deps.addressService.getAddress(
		event.accountConfigId,
		[event.addressId],
	);
	return address?.flags?.neverSpam?.value === true;
};

const NEVER_SPAM_DECISION: PlacementDecision = {
	verdict: {
		action: "move-to-inbox",
		confidence: "confident",
		reasons: ["sender=never-spam"],
	},
	destination: "inbox",
};

/**
 * Move a never-spam sender's Junk mail to the Inbox (#1553 Decision 6), the
 * newest {@link NEVER_SPAM_BACKAPPLY_LIMIT} per account. Delivery is
 * at-least-once, so each one re-reads the flag first and does nothing once it
 * is off.
 *
 * Wait, not reconcile (imap-mutations R2/R3): the selection skips rows a user
 * move or a spam report has placed, and `moveMessage` binds to the settled row
 * still in Junk, so a user move that lands after the selection wins and the
 * message is counted as skipped. A redelivery re-selects what is still in
 * Junk.
 */
export const backApplyNeverSpam = async (
	deps: NeverSpamBackApplyDeps,
	event: SenderNeverSpamBackApplyEvent,
	now: number,
): Promise<NeverSpamBackApplyResult> => {
	const result: NeverSpamBackApplyResult = {
		outcome: "Done",
		moved: 0,
		skipped: 0,
	};
	if (!(await neverSpamStands(deps, event))) {
		return { ...result, outcome: "FlagCleared" };
	}

	const verdict = {
		placementDecidedAt: now,
		placementVerdict: placementVerdictRecord(NEVER_SPAM_DECISION, "junk", now),
		movedByRemit: true,
	};
	const accounts = await deps.accountService.listMailSourcesByAccountConfig(
		event.accountConfigId,
	);
	for (const account of accounts) {
		const junk = await deps.mailboxSpecialUseService.findJunkMailbox(
			account.accountId,
		);
		const inbox = await deps.mailboxSpecialUseService.findInboxMailbox(
			account.accountId,
		);
		if (!junk || !inbox) continue;
		const messages = await deps.messageService.listSenderJunk(
			junk.mailboxId,
			event.normalizedEmail,
			NEVER_SPAM_BACKAPPLY_LIMIT,
		);
		for (const message of messages) {
			const outcome = await deps.placementMoveService.moveMessage(
				event.accountConfigId,
				message.messageId,
				inbox.mailboxId,
				account.accountId,
				junk.mailboxId,
			);
			if (outcome !== "filed") {
				result.skipped += 1;
				continue;
			}
			await deps.messageService.update(message.messageId, verdict);
			result.moved += 1;
		}
	}
	return result;
};
