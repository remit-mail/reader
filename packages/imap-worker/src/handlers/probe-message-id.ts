import type { IThreadMessageRepository } from "@remit/data-ports";
import { isValidMessageId } from "@remit/data-ports/id";

export const probeableMessageIdHeader = async (
	threadMessageService: Pick<IThreadMessageRepository, "findByMessageId">,
	accountConfigId: string,
	messageId: string,
): Promise<string | undefined> => {
	const row = await threadMessageService.findByMessageId(
		accountConfigId,
		messageId,
	);
	const header = row?.messageIdHeader;
	return isValidMessageId(header) ? header : undefined;
};
