import type { MessageItem } from "@remit/remit-electrodb-service";
import { SenderTrust } from "@remit/domain-enums";

type SenderTrustValue = (typeof SenderTrust)[keyof typeof SenderTrust];

/**
 * Rescue rule for provider-junked mail.
 * Fires only when: provider flagged it spam + DMARC passed + sender looks legitimate.
 * Never re-rescues (movedByRemit guard).
 */
export const shouldRescueFromJunk = (
	message: MessageItem,
	senderTrust: SenderTrustValue,
): boolean => {
	if (message.movedByRemit) return false;
	if (!message.providerSpam?.classified) return false;
	if (message.authResult?.dmarc !== "Pass") return false;

	if (
		senderTrust === SenderTrust.Vip ||
		senderTrust === SenderTrust.Wellknown
	) {
		return true;
	}

	const isListMail =
		message.category === "newsletter" || message.category === "marketing";
	if (
		isListMail &&
		message.hasListUnsubscribe &&
		!message.authenticity?.dkimMismatch
	) {
		return true;
	}

	return false;
};
