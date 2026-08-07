import type { Readable } from "node:stream";
import {
	authorizeUploadRequest,
	parseOutboxAttachmentKey,
	type StorageService,
} from "@remit/storage-service";

/**
 * The self-hosted receiver for an attachment upload.
 *
 * A hosted deployment mints a presigned PUT and none of this runs: the browser
 * writes to block storage and the size is bound by the storage service itself.
 * Where there is no storage service to presign against, this route is the
 * equivalent, and it has to bind the same things — one attachment, one size,
 * for a while — on its own.
 */

export type CollectedBody =
	| { readonly outcome: "Collected"; readonly content: Buffer }
	| { readonly outcome: "TooLarge" };

/**
 * Read a request body, refusing it the moment it passes what was reserved.
 *
 * The count is checked per chunk and the stream destroyed on the one that
 * crosses the line, so a client that reserved a megabyte and started sending a
 * hundred is cut off after the first megabyte rather than after all of it.
 */
export const collectLimitedBody = async (
	stream: Readable,
	maxBytes: number,
): Promise<CollectedBody> => {
	const chunks: Buffer[] = [];
	let received = 0;

	for await (const chunk of stream) {
		const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
		received += buffer.length;
		if (received > maxBytes) {
			stream.destroy();
			return { outcome: "TooLarge" };
		}
		chunks.push(buffer);
	}

	return { outcome: "Collected", content: Buffer.concat(chunks) };
};

export interface ReceiveUploadInput {
	/** Decoded storage key, the `/outbox-upload/` prefix already stripped. */
	storageKey: string;
	exp: string | undefined;
	max: string | undefined;
	sig: string | undefined;
	body: Readable;
	nowSeconds: number;
	secret: string | undefined;
	/**
	 * Whether the database still holds a live reservation for this attachment.
	 * Injected rather than reached for, so the receiver stays a function of its
	 * request and the storage it writes to.
	 */
	findLiveReservation: (
		accountConfigId: string,
		outboxAttachmentId: string,
		nowSeconds: number,
	) => Promise<boolean>;
}

export interface UploadResult {
	status: number;
	reason: string;
}

export const receiveUpload = async (
	storage: StorageService,
	input: ReceiveUploadInput,
): Promise<UploadResult> => {
	const target = parseOutboxAttachmentKey(input.storageKey);
	if (!target) return { status: 404, reason: "not-an-attachment-key" };

	const auth = authorizeUploadRequest({
		secret: input.secret,
		relativePath: input.storageKey,
		exp: input.exp,
		max: input.max,
		sig: input.sig,
		nowSeconds: input.nowSeconds,
	});
	if (!auth.authorized) {
		return { status: auth.status, reason: auth.reason };
	}

	// A signed URL outlives the draft it was minted for, so possession of one is
	// not enough: the database has to still hold a live reservation for this
	// attachment. Without this a URL minted before a discard writes bytes back
	// under a draft that no longer exists. The hosted shape cannot make this
	// check — block storage receives the PUT directly — which is what the sweep
	// exists for.
	const reserved = await input.findLiveReservation(
		target.accountConfigId,
		target.outboxAttachmentId,
		input.nowSeconds,
	);
	if (!reserved) return { status: 409, reason: "no-live-reservation" };

	const collected = await collectLimitedBody(input.body, auth.maxBytes);
	if (collected.outcome === "TooLarge") {
		return { status: 413, reason: "over-reserved-size" };
	}

	// Exactly the reserved size, not merely under it — the same thing S3 binds
	// when it recomputes a presigned PUT's signature over the content-length it
	// was sent. A short body is a failed upload, and the completion would refuse
	// it anyway; refusing here means no partial object is left to refuse.
	if (collected.content.length !== auth.maxBytes) {
		return { status: 400, reason: "size-mismatch" };
	}

	await storage.storeOutboxAttachment({
		accountConfigId: target.accountConfigId,
		accountId: target.accountId,
		outboxMessageId: target.outboxMessageId,
		outboxAttachmentId: target.outboxAttachmentId,
		content: collected.content,
	});

	return { status: 204, reason: "stored" };
};
