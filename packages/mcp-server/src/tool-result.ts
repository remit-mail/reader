import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { isNotFoundError } from "@remit/data-ports/errors";
import { type Refusal, type Refused, refuse } from "@remit/mailbox-service";

export const asJson = (value: unknown): CallToolResult => ({
	content: [{ type: "text", text: JSON.stringify(value) }],
});

export const toolError = (message: string): CallToolResult => ({
	isError: true,
	content: [{ type: "text", text: message }],
});

const REFUSAL_FIX: Record<Refusal["kind"], string> = {
	Invalid: "",
	Forbidden: " Use an accountId and mailboxId from list_mailboxes.",
	NotFound: " Use an accountId and mailboxId from list_mailboxes.",
	Conflict: " Wait for it to settle, then call this tool again.",
	NotSettled: " Wait for it to settle, then call this tool again.",
};

const sentence = (message: string): string =>
	/[.!?]$/.test(message) ? message : `${message}.`;

export const refused = (refusal: Refusal): CallToolResult =>
	toolError(`${sentence(refusal.message)}${REFUSAL_FIX[refusal.kind]}`);

export const notFoundRefusal =
	(fix: string) =>
	(error: unknown): Refused => {
		if (!isNotFoundError(error)) throw error;
		const message = error instanceof Error ? error.message : "Not found";
		return refuse({
			kind: "NotFound",
			message: fix ? `${sentence(message)} ${fix}` : message,
		});
	};
