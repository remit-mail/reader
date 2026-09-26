import type { IMailboxRepository, MailboxItem } from "@remit/data-ports";
import { isNotFoundError } from "@remit/data-ports/errors";

export type MailboxRow =
	| { kind: "present"; mailbox: MailboxItem }
	| { kind: "gone"; mailboxId: string };

export const findMailboxRow = (
	mailboxService: Pick<IMailboxRepository, "get">,
	accountId: string,
	mailboxId: string,
): Promise<MailboxRow> =>
	mailboxService.get(accountId, mailboxId).then(
		(mailbox): MailboxRow =>
			mailbox ? { kind: "present", mailbox } : { kind: "gone", mailboxId },
		(error: unknown): MailboxRow => {
			if (isNotFoundError(error)) return { kind: "gone", mailboxId };
			throw error;
		},
	);
