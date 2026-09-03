import { Banner } from "./banner.js";

/**
 * Send waits for the message being quoted. Pressed before it lands, the send
 * would go out carrying the answer and nothing of what it answers — the defect
 * this refusal exists to make impossible rather than merely unlikely (#845.5).
 */
export const QUOTE_LOADING_MESSAGE = "Loading the message you're quoting.";

/**
 * The quoted original could not be fetched. A forward without it is an empty
 * message and a reply without it drops the thread, so the composer says so
 * where the message is being written instead of sending a message the user
 * believes carries the original.
 */
export const QUOTE_FAILED_MESSAGE =
	"The message you're quoting couldn't be loaded, so it won't be included.";

/**
 * The original arrived and holds no text — an attachment-only message. The
 * reply is still a message of the user's own, so it goes, but it goes without
 * the thread and the composer says which (#1030).
 */
export const QUOTE_EMPTY_REPLY_MESSAGE =
	"The message you're replying to has no text to quote, so your reply won't include it.";

/**
 * The same original under a forward, where it is the whole message. The
 * composer cannot attach files, so a forward of an attachment-only message
 * would leave carrying nothing of what it forwards — it is refused rather than
 * sent empty, and the refusal names the way out (#1030).
 */
export const QUOTE_EMPTY_FORWARD_MESSAGE =
	"This message has no text to forward, and its attachments can't be forwarded from here yet. Send it on from another mail app.";

/** Which account of the quoted original the composer is giving. */
export type ComposeQuoteNoticeKind = "failed" | "empty-reply" | "empty-forward";

const messages: Record<ComposeQuoteNoticeKind, string> = {
	failed: QUOTE_FAILED_MESSAGE,
	"empty-reply": QUOTE_EMPTY_REPLY_MESSAGE,
	"empty-forward": QUOTE_EMPTY_FORWARD_MESSAGE,
};

const testIds: Record<ComposeQuoteNoticeKind, string> = {
	failed: "compose-quote-failed",
	"empty-reply": "compose-quote-empty",
	"empty-forward": "compose-quote-empty",
};

export interface ComposeQuoteNoticeProps {
	kind: ComposeQuoteNoticeKind;
	/**
	 * Offered only where a second attempt can change the answer. A source that
	 * arrived holding no text will hold none on the next read, and a retry that
	 * cannot succeed reads as the user's fault for not pressing it.
	 */
	onRetry?: () => void;
}

/**
 * What the composer says about the original a reply or a forward carries when
 * it will not carry it. One banner for every such outcome, so the app and the
 * workbench state the same fact in the same words.
 */
export const ComposeQuoteNotice = ({
	kind,
	onRetry,
}: ComposeQuoteNoticeProps) => (
	<Banner tone="warning" data-testid={testIds[kind]}>
		<span>{messages[kind]}</span>
		{onRetry ? (
			<>
				{" "}
				<button type="button" className="underline" onClick={onRetry}>
					Try again
				</button>
			</>
		) : null}
	</Banner>
);
