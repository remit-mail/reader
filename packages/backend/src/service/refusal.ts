import {
	BadRequestError,
	ForbiddenError,
	type HTTPError,
	MailboxNotSettledError,
	NotFoundError,
} from "@remit/data-ports/errors";
import type { Refusable, Refusal } from "@remit/mailbox-service";

export const refusalError = (refusal: Refusal): HTTPError => {
	switch (refusal.kind) {
		case "Invalid":
			return new BadRequestError(refusal.message);
		case "Forbidden":
			return new ForbiddenError(refusal.message);
		case "NotFound":
			return new NotFoundError(refusal.message);
		case "NotSettled":
			return new MailboxNotSettledError(
				refusal.message,
				refusal.mailboxId,
				refusal.syncStatus,
			);
	}
};

export const unwrap = <T>(outcome: Refusable<T>): T => {
	if (outcome.ok) return outcome.value;
	throw refusalError(outcome.refusal);
};
