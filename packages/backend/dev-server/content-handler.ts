import { gunzipSync } from "node:zlib";
import { parseContentStorageKey } from "@remit/storage-service";

// Re-exported for existing same-package consumers (server.ts,
// content-handler.test.ts). The key-shape parser itself lives in
// `@remit/storage-service` next to the `build*Key` functions it
// inverts, so non-backend consumers (e.g. the content-selfheal worker) can
// depend on it without pulling in the rest of `@remit/backend`.
export { parseContentStorageKey };

export interface ContentResult {
	status: number;
	headers: Record<string, string>;
	body: string | Buffer;
}

export interface ServeContentDeps {
	/**
	 * Reads the stored bytes, or returns null when the object is genuinely
	 * missing (ENOENT / NoSuchKey). Any other read error must throw so the route
	 * 500s — a permission/infra failure is never masked as a missing body.
	 */
	readObject(fullPath: string): Promise<Buffer | null>;
	/** Resolves the message's mailbox + uid so the cue can issue one FETCH. */
	lookupMessage(
		messageId: string,
	): Promise<{ mailboxId: string; uid: number } | null>;
	requestBodySync(input: {
		accountId: string;
		mailboxId: string;
		messageId: string;
		uid?: number;
	}): Promise<void>;
}

/**
 * Local stand-in for the CloudFront `/content/*` behavior. Body-fetch outcomes:
 *
 * - Object present → 200 with the (decompressed) bytes.
 * - Object missing → 202 + `Retry-After: 1`, and re-arm the SYNC_MESSAGE_BODY
 *   cue for that message so a retry succeeds once the worker stores the body.
 * - Any other read failure throws, so the route 500s loudly.
 */
export const serveContent = async (
	deps: ServeContentDeps,
	args: { fullPath: string; storageKey: string },
): Promise<ContentResult> => {
	const raw = await deps.readObject(args.fullPath);

	if (raw) {
		// The filesystem/S3 backends gzip every part; decompress here since there
		// is no CloudFront to auto-decode locally.
		const buffer = raw[0] === 0x1f && raw[1] === 0x8b ? gunzipSync(raw) : raw;
		return {
			status: 200,
			headers: { "content-type": "application/octet-stream" },
			body: buffer,
		};
	}

	const ids = parseContentStorageKey(args.storageKey);
	if (ids) {
		const message = await deps.lookupMessage(ids.messageId);
		if (message) {
			await deps.requestBodySync({
				accountId: ids.accountId,
				mailboxId: message.mailboxId,
				messageId: ids.messageId,
				uid: message.uid,
			});
		}
	}

	return {
		status: 202,
		headers: { "Retry-After": "1" },
		body: "body not yet synced",
	};
};
