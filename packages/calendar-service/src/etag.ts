import { createHash } from "node:crypto";

/**
 * Strong entity tag over the resource's stored bytes.
 *
 * Computed over the bytes exactly as they are stored — CRLF and all — rather
 * than over a reparse of them, so the tag of an untouched resource never moves.
 * Unquoted: HTTP's quoting is the transport's business, and a stored tag that
 * carried the quotes would have to be stripped by everything that compares it.
 */
export const computeEtag = (icalData: string): string =>
	createHash("sha256").update(icalData, "utf8").digest("hex");
