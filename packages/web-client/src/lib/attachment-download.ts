import { classifyBodyFetchFailure } from "@/hooks/useMessageBodyContent";
import { buildBugReportContext, buildGitHubIssueUrl } from "./bug-report";
import { taggedFetch } from "./network-error";

/**
 * Why an attachment download failed. Same edge/origin discrimination the body
 * fetch performs (`classifyBodyFetchFailure`) — the bytes travel the same
 * `/content/*` route — narrowed to the outcomes a download can act on.
 *
 * - `auth` — the edge denied the request; the session has to be renewed.
 * - `link-expired` — the self-host signature on the URL aged out (1 hour, and
 *   `describeMessage` is cached for 30 minutes, so an open message outlives it).
 *   Fixed by re-reading the message, which mints a fresh signature.
 * - `missing` — the request passed auth and storage had no object at the key.
 * - `not-ready` — 202: the part has not been stored yet and a cue was re-armed.
 * - `generic` — anything else, including a transport failure.
 */
export type AttachmentFetchReason =
	| "auth"
	| "link-expired"
	| "missing"
	| "not-ready"
	| "generic";

/**
 * The failures a fresh `describeMessage` read repairs on its own: it re-signs
 * every `contentUrl`, and materializing the deferred per-part objects is a side
 * effect of that same read.
 */
export const isRepairableByRefetch = (reason: AttachmentFetchReason): boolean =>
	reason === "link-expired" || reason === "not-ready";

export class AttachmentFetchError extends Error {
	readonly reason: AttachmentFetchReason;
	readonly status?: number;

	constructor(reason: AttachmentFetchReason, message: string, status?: number) {
		super(message);
		this.name = "AttachmentFetchError";
		this.reason = reason;
		this.status = status;
	}
}

const REASON_HEADER = "x-remit-403-reason";

/** The `verifyContentSignature` failure the self-host `/content` route reports. */
const EXPIRED_SIGNATURE_REASON = "expired";

export const classifyAttachmentFailure = (
	status: number,
	reasonHeader: string | null,
): AttachmentFetchReason => {
	if (reasonHeader?.trim() === EXPIRED_SIGNATURE_REASON) return "link-expired";
	const bodyReason = classifyBodyFetchFailure(status, reasonHeader);
	if (bodyReason === "auth") return "auth";
	if (bodyReason === "body-missing") return "missing";
	return "generic";
};

/**
 * Fetch one attachment's bytes from its `contentUrl`.
 *
 * The self-host stack authorizes `/content/*` with the signature already in the
 * URL; AWS authorizes it with the session bearer token at the edge. Sending the
 * token when there is one covers both, and matches `fetchBodyContent`.
 *
 * Throws on anything that is not a 200 so the caller renders the failure. A
 * download that silently produces no file is the bug this whole change exists
 * to remove — including the silence of a transfer that stalls, which the
 * timeout converts into a stated failure.
 */
export const ATTACHMENT_FETCH_TIMEOUT_MS = 5 * 60 * 1000;

export const fetchAttachment = async (
	url: string,
	getToken: () => Promise<string | null>,
): Promise<Blob> => {
	const headers: Record<string, string> = {};
	const token = await getToken();
	if (token) headers.Authorization = `Bearer ${token}`;

	const response = await taggedFetch(url, {
		headers,
		signal: AbortSignal.timeout(ATTACHMENT_FETCH_TIMEOUT_MS),
	});
	if (response.status === 202) {
		throw new AttachmentFetchError(
			"not-ready",
			"Attachment is still being fetched from the mail server",
			202,
		);
	}
	if (!response.ok) {
		throw new AttachmentFetchError(
			classifyAttachmentFailure(
				response.status,
				response.headers.get(REASON_HEADER),
			),
			`Failed to download attachment (${response.status} ${response.statusText})`,
			response.status,
		);
	}
	return response.blob();
};

export interface AttachmentFailureContent {
	title: string;
	detail: string;
}

export const attachmentFailureContent = (
	reason: AttachmentFetchReason,
	filename: string,
	fallback: string,
): AttachmentFailureContent => {
	switch (reason) {
		case "auth":
			return {
				title: "Your session expired",
				detail: `Sign in again, then download ${filename} once more. Other parts of the app may also stop responding until you do.`,
			};
		case "link-expired":
			return {
				title: "This download link expired and could not be renewed",
				detail: `Reload the page, then download ${filename} again. If that keeps failing, this is worth reporting.`,
			};
		case "missing":
			return {
				title: "This attachment is missing from storage",
				detail:
					"Remit has the message but not the file. Re-sync the account from Settings, then try again.",
			};
		case "not-ready":
			return {
				title: "Still fetching this attachment",
				detail:
					"Remit is downloading it from the mail server now. Try again in a few seconds.",
			};
		default:
			return { title: "Couldn't download this attachment", detail: fallback };
	}
};

export const extractAttachmentFailureReason = (
	error: unknown,
): AttachmentFetchReason =>
	error instanceof AttachmentFetchError ? error.reason : "generic";

export const extractAttachmentFailureDetail = (error: unknown): string => {
	if (error instanceof Error) return error.message;
	if (typeof error === "string") return error;
	return "An unexpected error occurred while downloading this attachment.";
};

/**
 * A prefilled issue URL for a download failure, so the user has somewhere to go
 * that is not "try again forever". Not offered for an expired session, which is
 * the user's to fix and not a bug.
 */
export const attachmentReportUrl = (
	reason: AttachmentFetchReason,
	filename: string,
	detail: string,
): string | undefined => {
	if (reason === "auth") return undefined;
	return buildGitHubIssueUrl(
		buildBugReportContext({
			title: `Bug: attachment download failed (${reason})`,
			errorMessage: `Downloading "${filename}" failed: ${detail}`,
		}),
	);
};

/**
 * Hand the fetched bytes to the browser's download machinery under the
 * sanitized name.
 *
 * A plain `<a href={contentUrl} download>` cannot do this job: on AWS the
 * content URL is a different origin, where the `download` attribute is ignored
 * and the browser navigates instead. The object URL is same-origin, so the
 * attribute holds and the filename we chose is the filename that lands.
 */
export const saveBlob = (blob: Blob, filename: string): void => {
	const objectUrl = URL.createObjectURL(blob);
	const anchor = document.createElement("a");
	anchor.href = objectUrl;
	anchor.download = filename;
	anchor.rel = "noopener";
	document.body.append(anchor);
	anchor.click();
	anchor.remove();
	// Revoking in the same task as the click cancels the download in WebKit.
	setTimeout(() => URL.revokeObjectURL(objectUrl), 0);
};
