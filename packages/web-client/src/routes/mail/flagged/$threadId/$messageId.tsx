/**
 * /mail/flagged/$threadId/$messageId — the same conversation, with one of its
 * messages expanded and scrolled to.
 *
 * A message is not addressable on its own: `GET /messages/{messageId}` answers
 * with no thread, so the pane has nothing to fetch by. The segment names which
 * message inside the thread the reader pointed at, and the surface it renders is
 * the thread's.
 */
import { createFileRoute } from "@tanstack/react-router";
import { FlaggedPane } from "@/components/mail/FlaggedPane";

function FlaggedMessagePane() {
	return <FlaggedPane.Reading />;
}

export const Route = createFileRoute("/mail/flagged/$threadId/$messageId")({
	component: FlaggedMessagePane,
});
