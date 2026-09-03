import type { RemitImapThreadMessageResponse } from "@remit/api-http-client/types.gen.ts";
import { messageSettlementOf } from "@remit/data-ports";
import { MessageSettlementNotice, messageSettlementCopy } from "@remit/ui";
import { buildBugReportContext, buildGitHubIssueUrl } from "@/lib/bug-report";

/**
 * States, on the open message, that its last IMAP mutation did not settle
 * (issue #1002) — the failure the message list can only hint at with a chip.
 *
 * A mutation that gave up is a dead end by design: every mutating endpoint
 * refuses a row in that state (`placementBindingOf` → `abandoned`), and the
 * sync path refuses to repoint it (`repointsOnSighting`). So this states what
 * happened and offers the prefilled issue link rather than a Retry button that
 * would fail on every press.
 */
export function MessageSettlementAlert({
	threadMessage,
	className,
}: {
	threadMessage: RemitImapThreadMessageResponse;
	className?: string;
}) {
	const settlement = messageSettlementOf(threadMessage);
	if (settlement === "settled") return null;

	const reportHref =
		settlement === "abandoned"
			? buildGitHubIssueUrl(
					buildBugReportContext({
						title: messageSettlementCopy.abandoned.title,
						errorMessage: `Message ${threadMessage.messageId}: status=${threadMessage.status} syncStatus=${threadMessage.syncStatus}`,
					}),
				)
			: undefined;

	return (
		<MessageSettlementNotice
			settlement={settlement}
			reportHref={reportHref}
			className={className}
		/>
	);
}
