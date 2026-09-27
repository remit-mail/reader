import type {
	RemitImapOutboxAttachmentRejectionReason,
	RemitImapOutboxAttachmentResponse,
} from "@remit/api-http-client/types.gen.ts";
import type { ComposeAttachmentItem, ComposeAttachmentState } from "@remit/ui";
import { formatErrorDetail } from "../components/ui/error-banners";

export type DraftForAttachment =
	| { outcome: "ready"; outboxMessageId: string }
	| { outcome: "refused"; reason: string };

export interface MintedAttachment {
	outboxAttachmentId: string;
	filename: string;
	contentType: string;
	contentId: string;
	uploadUrl: string;
}

export interface CompletedAttachment {
	contentUrl: string;
}

export interface AttachmentPlacement {
	stored: (file: File, contentId: string) => void;
	failed: (file: File) => void;
}

export interface StoredContent {
	filename: string;
	contentType: string;
	contentUrl: string;
}

/** The four requests a file on a draft is made of. Each throws on failure. */
export interface AttachmentTransport {
	mint: (outboxMessageId: string, file: File) => Promise<MintedAttachment>;
	put: (uploadUrl: string, file: File, signal: AbortSignal) => Promise<void>;
	complete: (
		outboxMessageId: string,
		outboxAttachmentId: string,
	) => Promise<CompletedAttachment>;
	keep: (outboxMessageId: string, attachmentIds: string[]) => Promise<void>;
}

export interface ComposeAttachmentControllerDeps {
	transport: () => AttachmentTransport;
	ensureDraft: () => Promise<DraftForAttachment>;
}

interface Entry extends ComposeAttachmentItem {
	serverId: string | null;
	file: File | null;
	placement: AttachmentPlacement | null;
	contentId: string | null;
	contentType: string;
	contentUrl: string | null;
}

interface AttachmentRejection {
	code: "attachment_rejected";
	reason: RemitImapOutboxAttachmentRejectionReason;
	message: string;
}

const isRejection = (error: unknown): error is AttachmentRejection =>
	typeof error === "object" &&
	error !== null &&
	"code" in error &&
	error.code === "attachment_rejected" &&
	"message" in error &&
	typeof error.message === "string";

/**
 * Refusals about the file itself. Pressing again sends the same file and is
 * refused the same way, so the row offers removal and nothing else.
 */
const FINAL_REASONS: ReadonlySet<RemitImapOutboxAttachmentRejectionReason> =
	new Set([
		"EmptyFile",
		"UnusableFilename",
		"FileTooLarge",
		"TooManyAttachments",
	]);

const UPLOADING: ComposeAttachmentState = { status: "uploading" };
const ATTACHED: ComposeAttachmentState = { status: "attached" };

const failed = (
	reason: string,
	retryable: boolean,
): ComposeAttachmentState => ({
	status: "failed",
	reason,
	retryable,
});

const refusalOf = (
	filename: string,
	error: unknown,
): ComposeAttachmentState => {
	if (isRejection(error)) {
		return failed(error.message, !FINAL_REASONS.has(error.reason));
	}
	return failed(
		`"${filename}" could not be attached: ${formatErrorDetail(error) ?? "the request failed"}. Try again.`,
		true,
	);
};

const fromServer = (attachment: RemitImapOutboxAttachmentResponse): Entry => ({
	key: attachment.outboxAttachmentId,
	serverId: attachment.outboxAttachmentId,
	file: null,
	placement: null,
	contentId: attachment.contentId,
	contentType: attachment.contentType,
	contentUrl: attachment.contentUrl,
	filename: attachment.filename,
	sizeBytes: attachment.sizeBytes,
	state:
		attachment.state === "Stored"
			? ATTACHED
			: failed(
					`"${attachment.filename}" did not finish uploading. Remove it and attach it again.`,
					false,
				),
});

/**
 * The files on the draft being written, and the requests that put each one
 * there: reserve room, upload the bytes, confirm them.
 *
 * What the draft keeps is stated to the server as a whole list, so a removal
 * waits for every reservation still in flight: a list sent before one comes
 * back would not name it, and the server would drop a file the writer kept.
 * A file removed mid-upload is left out of that list once its reservation
 * lands, which is what takes it off the draft — pulling the row alone would
 * leave the upload to finish and the file to go out unseen.
 */
export class ComposeAttachmentController {
	private entries: Entry[] = [];
	private snapshot: ComposeAttachmentItem[] = [];
	private readonly listeners = new Set<() => void>();
	private generation = 0;
	private draftId: string | undefined;
	private nextKey = 0;
	private readonly reservationsInFlight = new Set<Promise<void>>();
	private readonly inFlight = new Map<string, AbortController>();
	private readonly mintedAfterRemoval = new Map<string, string>();
	private readonly removing = new Map<string, string>();
	private readonly removedListeners = new Set<(contentId: string) => void>();
	private loaded = false;

	constructor(private readonly deps: ComposeAttachmentControllerDeps) {}

	subscribe = (listener: () => void): (() => void) => {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	};

	getSnapshot = (): ComposeAttachmentItem[] => this.snapshot;

	owns = (contentId: string): boolean =>
		this.entries.some((entry) => entry.contentId === contentId);

	storedContent = (contentId: string): StoredContent | null => {
		const entry = this.entries.find(
			(candidate) =>
				candidate.contentId === contentId && candidate.contentUrl !== null,
		);
		if (!entry?.contentUrl) return null;
		return {
			filename: entry.filename,
			contentType: entry.contentType,
			contentUrl: entry.contentUrl,
		};
	};

	isLoaded = (): boolean => this.loaded;

	refreshLinks = (
		attachments: readonly RemitImapOutboxAttachmentResponse[],
	): void => {
		const links = new Map(
			attachments.map((attachment) => [
				attachment.outboxAttachmentId,
				attachment.contentUrl,
			]),
		);
		this.set(
			this.entries.map((entry) => {
				const contentUrl =
					entry.serverId === null ? undefined : links.get(entry.serverId);
				return contentUrl === undefined ? entry : { ...entry, contentUrl };
			}),
		);
	};

	onRemoved = (listener: (contentId: string) => void): (() => void) => {
		this.removedListeners.add(listener);
		return () => this.removedListeners.delete(listener);
	};

	blockingReason = (): string | undefined => {
		const [removing] = this.removing.values();
		if (removing !== undefined) return `Removing "${removing}"…`;
		const uploading = this.entries.find(
			(entry) => entry.state.status === "uploading",
		);
		if (uploading) return `"${uploading.filename}" is still uploading.`;
		const broken = this.entries.find(
			(entry) => entry.state.status === "failed",
		);
		if (broken) {
			return `"${broken.filename}" is not attached. Try it again or remove it before sending.`;
		}
		return undefined;
	};

	private set(next: Entry[]): void {
		this.entries = next;
		this.snapshot = next.map(({ key, filename, sizeBytes, state }) => ({
			key,
			filename,
			sizeBytes,
			state,
		}));
		for (const listener of this.listeners) listener();
	}

	private patch(generation: number, key: string, change: Partial<Entry>): void {
		if (generation !== this.generation) return;
		if (!this.entries.some((entry) => entry.key === key)) return;
		this.set(
			this.entries.map((entry) =>
				entry.key === key ? { ...entry, ...change } : entry,
			),
		);
	}

	private reserve(
		outboxMessageId: string,
		file: File,
	): { minted: Promise<MintedAttachment>; settle: () => void } {
		let settle = () => {};
		const slot = new Promise<void>((resolve) => {
			settle = () => {
				this.reservationsInFlight.delete(slot);
				resolve();
			};
		});
		this.reservationsInFlight.add(slot);
		return {
			minted: this.deps.transport().mint(outboxMessageId, file),
			settle,
		};
	}

	private upload = async (
		generation: number,
		key: string,
		file: File,
		outboxMessageId: string,
		signal: AbortSignal,
	): Promise<void> => {
		if (signal.aborted) return;
		const transport = this.deps.transport();
		const { minted: minting, settle } = this.reserve(outboxMessageId, file);
		const minted = await minting.catch((error: unknown) => {
			this.patch(generation, key, { state: refusalOf(file.name, error) });
			return null;
		});
		if (minted !== null && signal.aborted) {
			this.mintedAfterRemoval.set(key, minted.outboxAttachmentId);
		}
		if (minted !== null && !signal.aborted) {
			this.patch(generation, key, {
				serverId: minted.outboxAttachmentId,
				filename: minted.filename,
				contentId: minted.contentId,
				contentType: minted.contentType,
			});
		}
		settle();
		if (minted === null || signal.aborted) return;

		const putFailure = await transport.put(minted.uploadUrl, file, signal).then(
			() => null,
			(error: unknown) => formatErrorDetail(error) ?? "the connection dropped",
		);
		if (signal.aborted) return;
		if (putFailure !== null) {
			this.patch(generation, key, {
				state: failed(
					`"${minted.filename}" did not finish uploading: ${putFailure}. Try again.`,
					true,
				),
			});
			return;
		}

		const completed = await transport
			.complete(outboxMessageId, minted.outboxAttachmentId)
			.catch((error: unknown) => {
				this.patch(generation, key, {
					state: refusalOf(minted.filename, error),
				});
				return null;
			});
		if (completed === null || signal.aborted) return;
		this.patch(generation, key, {
			state: ATTACHED,
			contentUrl: completed.contentUrl,
		});
		if (generation !== this.generation) return;
		this.entries
			.find((entry) => entry.key === key)
			?.placement?.stored(file, minted.contentId);
	};

	private settleFailure(generation: number, key: string, file: File): void {
		if (generation !== this.generation) return;
		const entry = this.entries.find((candidate) => candidate.key === key);
		if (entry?.state.status === "failed") entry.placement?.failed(file);
	}

	private run = async (
		generation: number,
		key: string,
		file: File,
		outboxMessageId: string,
		signal: AbortSignal,
	): Promise<void> => {
		await this.upload(generation, key, file, outboxMessageId, signal);
		if (this.inFlight.get(key)?.signal === signal) this.inFlight.delete(key);
		this.settleFailure(generation, key, file);
	};

	/**
	 * Tell the server what the draft keeps, once no reservation is still out.
	 * Answers whether the server took it.
	 */
	private syncKept = async (generation: number): Promise<unknown> => {
		while (this.reservationsInFlight.size > 0) {
			await Promise.all([...this.reservationsInFlight]);
		}
		const outboxMessageId = this.draftId;
		if (generation !== this.generation || outboxMessageId === undefined) {
			return null;
		}
		return this.deps
			.transport()
			.keep(
				outboxMessageId,
				this.entries.flatMap((entry) =>
					entry.serverId === null ? [] : [entry.serverId],
				),
			)
			.then(
				() => null,
				(error: unknown) => error ?? new Error("the request failed"),
			);
	};

	attach = async (
		files: File[],
		placement?: AttachmentPlacement,
	): Promise<void> => {
		const generation = this.generation;
		const added = files.map((file) => {
			this.nextKey += 1;
			const entry: Entry = {
				key: `local-${this.nextKey}`,
				serverId: null,
				file,
				placement: placement ?? null,
				contentId: null,
				contentType: file.type || "application/octet-stream",
				contentUrl: null,
				filename: file.name,
				sizeBytes: file.size,
				state: UPLOADING,
			};
			const controller = new AbortController();
			this.inFlight.set(entry.key, controller);
			return { entry, file, signal: controller.signal };
		});
		this.set([...this.entries, ...added.map(({ entry }) => entry)]);

		const draft = await this.deps.ensureDraft();
		if (draft.outcome === "refused") {
			for (const { entry, file } of added) {
				this.inFlight.delete(entry.key);
				this.patch(generation, entry.key, {
					state: failed(draft.reason, true),
				});
				this.settleFailure(generation, entry.key, file);
			}
			return;
		}
		if (generation !== this.generation) return;
		this.draftId = draft.outboxMessageId;

		await Promise.all(
			added.map(({ entry, file, signal }) =>
				this.run(generation, entry.key, file, draft.outboxMessageId, signal),
			),
		);
	};

	retry = async (key: string): Promise<void> => {
		const entry = this.entries.find((candidate) => candidate.key === key);
		if (!entry || entry.file === null || this.inFlight.has(key)) return;
		const file = entry.file;
		const generation = this.generation;
		const controller = new AbortController();
		this.inFlight.set(key, controller);
		this.patch(generation, key, { state: UPLOADING, serverId: null });

		const draft = await this.deps.ensureDraft();
		if (draft.outcome === "refused") {
			this.inFlight.delete(key);
			this.patch(generation, key, { state: failed(draft.reason, true) });
			return;
		}
		this.draftId = draft.outboxMessageId;

		if (entry.serverId !== null) {
			const failure = await this.syncKept(generation);
			if (failure !== null) {
				this.inFlight.delete(key);
				this.patch(generation, key, {
					serverId: entry.serverId,
					state: refusalOf(file.name, failure),
				});
				return;
			}
		}

		await this.run(
			generation,
			key,
			file,
			draft.outboxMessageId,
			controller.signal,
		);
	};

	remove = async (key: string): Promise<void> => {
		const entry = this.entries.find((candidate) => candidate.key === key);
		if (!entry) return;
		const generation = this.generation;
		const uploading = this.inFlight.get(key);
		this.set(this.entries.filter((candidate) => candidate.key !== key));
		if (uploading) {
			this.inFlight.delete(key);
			uploading.abort();
		}
		if (entry.serverId === null && !uploading) return;

		// Until the server has dropped it the file is still on the draft, and a
		// Send pressed in that window would carry it.
		this.removing.set(key, entry.filename);
		this.set(this.entries);
		const failure = await this.syncKept(generation);
		this.removing.delete(key);
		this.set(this.entries);
		const serverId = entry.serverId ?? this.mintedAfterRemoval.get(key) ?? null;
		this.mintedAfterRemoval.delete(key);
		if (generation !== this.generation) return;
		if (failure === null) {
			if (entry.contentId === null) return;
			for (const listener of this.removedListeners) listener(entry.contentId);
			return;
		}
		if (serverId === null) return;
		this.set([
			...this.entries,
			{
				...entry,
				serverId,
				file: null,
				state: failed(
					`"${entry.filename}" could not be removed: ${formatErrorDetail(failure) ?? "the request failed"}. It is still on the draft — remove it again.`,
					false,
				),
			},
		]);
	};

	load = (
		outboxMessageId: string,
		attachments: readonly RemitImapOutboxAttachmentResponse[],
	): void => {
		this.draftId = outboxMessageId;
		this.loaded = true;
		const listed = new Set(
			attachments.map((attachment) => attachment.outboxAttachmentId),
		);
		const attachedHere = this.entries.filter(
			(entry) =>
				entry.file !== null &&
				(entry.serverId === null || !listed.has(entry.serverId)),
		);
		this.set([...attachments.map(fromServer), ...attachedHere]);
	};

	reset = (outboxMessageId: string | undefined): void => {
		this.generation += 1;
		for (const controller of this.inFlight.values()) controller.abort();
		this.inFlight.clear();
		this.mintedAfterRemoval.clear();
		this.removing.clear();
		this.draftId = outboxMessageId;
		this.loaded = false;
		this.set([]);
	};
}
