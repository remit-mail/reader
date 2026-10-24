import type { MailboxItem } from "@remit/data-ports";

export type AccessMode = "read" | "act";

export type Refusal =
	| { kind: "Invalid"; message: string }
	| { kind: "Forbidden"; message: string }
	| { kind: "NotFound"; message: string }
	| {
			kind: "NotSettled";
			message: string;
			mailboxId: string;
			syncStatus: MailboxItem["syncStatus"];
	  };

export interface Refused {
	ok: false;
	refusal: Refusal;
}

export type Refusable<T> = { ok: true; value: T } | Refused;

export const accept = <T>(value: T): Refusable<T> => ({ ok: true, value });

export const refuse = (refusal: Refusal): Refused => ({ ok: false, refusal });

export const invalid = (message: string): Refused =>
	refuse({ kind: "Invalid", message });
