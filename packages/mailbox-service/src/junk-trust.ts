import {
	AddressService,
	type ThreadMessageService,
} from "@remit/remit-electrodb-service";

/**
 * Sender-trust side-effect of moving a message across the Junk boundary
 * (issue #594).
 *
 * - Out of Junk (any destination): the strongest trust signal a user can give.
 *   Promote the sender straight to `Wellknown` via the existing engagement
 *   `flags.wellknown` axis, stamped `user-junk-rescue` so it is traceable apart
 *   from a passive `auto-engagement` promotion. The existing rescue predicate
 *   honours Wellknown, so future mail from this sender is never re-junked.
 * - Into Junk: the explicit inverse. Strip the sender's earned trust
 *   (`wellknown`/`vip` cleared, counters zeroed) so the engagement ladder
 *   cannot immediately re-promote and future mail can be junked again.
 *
 * Address rows are created eagerly at message ingestion (every parseable sender
 * gets one when its message is synced), so a sender whose message sits in a
 * mailbox is guaranteed an Address row. This trust adjustment is business
 * logic, not a best-effort side effect: it writes that row directly, with no
 * defensive lookup and no catch. Any error — including a missing Address row
 * (`NotFoundError`), which would be a real bug — propagates and fails the
 * request. The only early returns are genuine no-trust-signal cases (a move
 * that does not cross the Junk boundary, or a message with no From address).
 */
export interface JunkTrustLogger {
	info(obj: Record<string, unknown>, msg: string): void;
}

export interface AdjustSenderTrustForJunkMoveInput {
	messageId: string;
	isMovingFromJunk: boolean;
	isMovingToJunk: boolean;
	addressService: AddressService;
	threadMessageService: Pick<ThreadMessageService, "getByMessageId">;
	log: JunkTrustLogger;
}

export const adjustSenderTrustForJunkMove = async (
	input: AdjustSenderTrustForJunkMoveInput,
): Promise<void> => {
	const { isMovingFromJunk, isMovingToJunk } = input;
	// A move that neither leaves nor enters Junk carries no trust signal. A move
	// that does both (Junk → Junk) is a no-op crossing — skip it.
	if (isMovingFromJunk === isMovingToJunk) return;

	await applyJunkTrust(input);
};

const applyJunkTrust = async ({
	messageId,
	isMovingFromJunk,
	addressService,
	threadMessageService,
	log,
}: AdjustSenderTrustForJunkMoveInput): Promise<void> => {
	const threadMessage = await threadMessageService.getByMessageId(messageId);
	const fromEmail = threadMessage.fromEmail;
	if (!fromEmail) {
		log.info({ messageId }, "Junk move: no From address; skipping trust");
		return;
	}

	const addressId = AddressService.generateAddressId(
		threadMessage.accountConfigId,
		fromEmail,
	);
	const now = Date.now();

	if (isMovingFromJunk) {
		await addressService.promoteWellknownByUser(addressId, now);
		log.info(
			{ messageId, addressId, fromEmail },
			"Promoted sender to Wellknown (user moved mail out of Junk)",
		);
		return;
	}

	await addressService.demoteSenderTrust(addressId, now);
	log.info(
		{ messageId, addressId, fromEmail },
		"Demoted sender trust (user moved mail into Junk)",
	);
};
