import { inspect } from "node:util";
import {
	AddressService,
	NotFoundError,
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
 * Best-effort: this is a learning enhancement, not part of the move contract.
 * The move has already been enqueued by the caller; any failure here is
 * swallowed with a warning so it can never fail the move. A missing
 * `fromEmail` or `Address` is treated as a no-op (nothing to promote/demote).
 */
export interface JunkTrustLogger {
	info(obj: Record<string, unknown>, msg: string): void;
	warn?(obj: Record<string, unknown>, msg: string): void;
}

export interface AdjustSenderTrustForJunkMoveInput {
	messageId: string;
	isMovingFromJunk: boolean;
	isMovingToJunk: boolean;
	addressService: AddressService;
	threadMessageService: Pick<ThreadMessageService, "getByMessageId">;
	log: JunkTrustLogger;
}

export const adjustSenderTrustForJunkMove = async ({
	messageId,
	isMovingFromJunk,
	isMovingToJunk,
	addressService,
	threadMessageService,
	log,
}: AdjustSenderTrustForJunkMoveInput): Promise<void> => {
	// A move that neither leaves nor enters Junk carries no trust signal. A move
	// that does both (Junk → Junk) is a no-op crossing — skip it.
	if (isMovingFromJunk === isMovingToJunk) return;

	try {
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
	} catch (err: unknown) {
		// A sender with no Address row yet (e.g. never counted) has no trust to
		// adjust — that is an expected no-op, not a failure.
		// biome-ignore lint/plugin/no-silent-catch: best-effort trust adjustment — a missing Address row (NotFoundError) or transient failure must not block the junk-move response
		if (err instanceof NotFoundError) {
			log.info(
				{ messageId },
				"Junk move: sender Address not found; skipping trust",
			);
			return;
		}
		log.warn?.(
			{ messageId, error: inspect(err) },
			"Junk-move trust adjustment failed (best-effort, non-fatal)",
		);
	}
};
