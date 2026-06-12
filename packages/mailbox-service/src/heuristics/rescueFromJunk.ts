import type { MessageItem } from "@remit/remit-electrodb-service";
import { SenderTrust } from "@remit/domain-enums";

type SenderTrustValue = (typeof SenderTrust)[keyof typeof SenderTrust];

export const shouldRescueFromJunk = (
	message: MessageItem,
	senderTrust: SenderTrustValue,
): boolean => {
	if (message.movedByRemit) return false;
	if (!message.providerSpam?.classified) return false;
	if (message.authResult?.dmarc !== "Pass") return false;
	return (
		senderTrust === SenderTrust.Vip || senderTrust === SenderTrust.Wellknown
	);
};
