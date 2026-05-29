import {
	BodyFetchError,
	type BodyFetchReason,
} from "@/hooks/useMessageBodyContent";

export interface BannerContent {
	title: string;
	detail: string;
}

/**
 * Pure helpers for `MessageBodyErrorBanner`. Extracted so they can be
 * unit-tested with the Node test runner without importing React /
 * @aws-amplify/ui-react / lucide-react. The banner component composes these
 * with the React surface.
 *
 * The variant copy lives here so a glance at one file shows every banner
 * variant the SPA can render — issue #401 / postmortem #394.
 */

/**
 * Map a `BodyFetchReason` to user-facing banner copy.
 *
 * - `auth` — Lambda@Edge denied the JWT (missing/invalid/expired) or the
 *            tenant didn't match. The user needs to sign in again.
 * - `body-missing` — CloudFront/S3 returned 403/404 without the edge reason
 *            header. The OAC bucket policy only grants `s3:GetObject` so a
 *            missing object surfaces as 403. Either an in-flight sync failure
 *            left the message stuck, or the body part was never written.
 * - `content-type-mismatch` / `spa-shell-leak` — defensive guards; the user
 *            sees a safer "couldn't load" message and is asked to report it.
 * - `generic` — anything else; surfaces the underlying error message so the
 *            user has something to attach to a support ticket.
 */
export const contentForReason = (
	reason: BodyFetchReason,
	fallback: string,
): BannerContent => {
	switch (reason) {
		case "auth":
			return {
				title: "Your session expired",
				detail:
					"Sign in again to reload the message body. Other parts of the app may also stop responding until you do.",
			};
		case "body-missing":
			return {
				title: "Message body is missing in storage",
				detail:
					"A sync failure may have left this message without its body bytes. Contact support, or run the reconcile script to refetch from the upstream IMAP server.",
			};
		case "content-type-mismatch":
			return {
				title: "Couldn't load message body",
				detail:
					"The server returned an unexpected content type for this part. The message body has not been rendered to keep you safe.",
			};
		case "spa-shell-leak":
			return {
				title: "Couldn't load message body",
				detail:
					"The server returned the app shell instead of the message body. This is an infrastructure bug — please report it.",
			};
		default:
			return {
				title: "Couldn't load message body",
				detail: fallback,
			};
	}
};

export const extractReason = (error: unknown): BodyFetchReason => {
	if (error instanceof BodyFetchError) return error.reason;
	return "generic";
};

export const extractFallbackDetail = (error: unknown): string => {
	if (error instanceof Error) return error.message;
	if (typeof error === "string") return error;
	return "An unexpected error occurred while loading the message body.";
};
