import { Banner } from "./banner.js";

/** Which of the two composers is looking at a source it cannot quote. */
export type ComposeQuoteMode = "reply" | "forward";

/**
 * The source has no text or html part — it is attachments and nothing else.
 *
 * A forward of one has nothing of the original to carry: the composer sends a
 * text body and an html body, and no attachments, so the message would arrive
 * holding only what the sender typed. Send refuses with these words. A reply
 * still carries the answer and the thread it belongs to, so it goes out and
 * these words say the original is not quoted in it. See #1030.
 */
export const NO_QUOTABLE_BODY_FORWARD_MESSAGE =
	"This message is attachments only, and attachments aren't forwarded — a forward would arrive with nothing of the original in it.";

export const NO_QUOTABLE_BODY_REPLY_MESSAGE =
	"This message is attachments only, so there's nothing to quote and your reply goes out without the original.";

export const composeQuoteMissingMessage = (mode: ComposeQuoteMode): string =>
	mode === "forward"
		? NO_QUOTABLE_BODY_FORWARD_MESSAGE
		: NO_QUOTABLE_BODY_REPLY_MESSAGE;

export interface ComposeQuoteMissingBannerProps {
	mode: ComposeQuoteMode;
}

export const ComposeQuoteMissingBanner = ({
	mode,
}: ComposeQuoteMissingBannerProps) => (
	<Banner tone="warning" data-testid="compose-quote-missing">
		<span>{composeQuoteMissingMessage(mode)}</span>
	</Banner>
);
