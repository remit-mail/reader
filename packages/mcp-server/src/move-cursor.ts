import {
	FILTER_NO_ACTION,
	type OrganizeJobRequestItem,
	OrganizeJobRuleSchema,
} from "@remit/data-ports";
import { z } from "zod";

const MoveCursorSchema = z.object({
	accountId: z.string().min(1),
	sourceMailboxId: z.string().min(1),
	actionMailboxId: z.string().min(1),
	actionLabelId: z.string().min(1),
	rule: OrganizeJobRuleSchema,
	sentAfter: z.string().min(1),
	sentBefore: z.string().min(1),
	startPosition: z.string().min(1),
});

export type MoveCursor = z.infer<typeof MoveCursorSchema>;

const toBase64Url = (text: string): string =>
	btoa(String.fromCharCode(...new TextEncoder().encode(text)))
		.replaceAll("+", "-")
		.replaceAll("/", "_")
		.replace(/=+$/, "");

const fromBase64Url = (encoded: string): string =>
	new TextDecoder().decode(
		Uint8Array.from(
			atob(encoded.replaceAll("-", "+").replaceAll("_", "/")),
			(char) => char.charCodeAt(0),
		),
	);

export const encodeMoveCursor = (cursor: MoveCursor): string =>
	toBase64Url(JSON.stringify(cursor));

const parsedJson = (encoded: string): unknown => {
	try {
		return JSON.parse(fromBase64Url(encoded));
	} catch {
		return null;
	}
};

export const decodeMoveCursor = (encoded: string): MoveCursor | null => {
	const parsed = MoveCursorSchema.safeParse(parsedJson(encoded));
	return parsed.success ? parsed.data : null;
};

/**
 * The cursor that continues a finished folder move: its selection and the
 * position the next batch starts at. Empty when nothing is left, or for a job
 * that did not move a folder's messages.
 */
export const moveCursorOf = (
	accountId: string,
	job: OrganizeJobRequestItem,
): string => {
	if (
		job.state !== "Complete" ||
		job.remainingCount === 0 ||
		job.nextPosition === "" ||
		job.sourceMailboxId === FILTER_NO_ACTION
	) {
		return "";
	}
	return encodeMoveCursor({
		accountId,
		sourceMailboxId: job.sourceMailboxId,
		actionMailboxId: job.actionMailboxId,
		actionLabelId: job.actionLabelId,
		rule: job.rule,
		sentAfter: job.sentAfter,
		sentBefore: job.sentBefore,
		startPosition: job.nextPosition,
	});
};
