import {
	BadRequestError,
	ForbiddenError,
	type HTTPError,
	MailboxNotSettledError,
	NotFoundError,
} from "@remit/data-ports/errors";

/**
 * Why a service call refused, independent of the transport that asked. REST
 * turns it back into the status and body it always answered with
 * (`refusalError`); another adapter words it its own way.
 */
export type Refusal =
	| { kind: "Invalid"; message: string }
	| { kind: "Forbidden"; message: string }
	| { kind: "NotFound"; message: string }
	| {
			kind: "NotSettled";
			message: string;
			mailboxId: string;
			syncStatus: string;
	  };

export type Refused = { ok: false; refusal: Refusal };

export type Outcome<T> = { ok: true; value: T } | Refused;

export const ok = <T>(value: T): Outcome<T> => ({ ok: true, value });

export const refuse = (refusal: Refusal): Refused => ({ ok: false, refusal });

export const invalid = (message: string): Refusal => ({
	kind: "Invalid",
	message,
});

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

export const unwrap = <T>(outcome: Outcome<T>): T => {
	if (outcome.ok) return outcome.value;
	throw refusalError(outcome.refusal);
};
