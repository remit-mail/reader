import type { Meta, StoryObj } from "@storybook/react";
import {
	MessageSettlementBadge,
	MessageSettlementNotice,
} from "./message-settlement.js";

const meta: Meta = {
	title: "Mail/MessageSettlement",
	parameters: { layout: "padded" },
};
export default meta;

type Story = StoryObj;

const reportHref =
	"https://github.com/remit-mail/reader/issues/new?title=This+message+was+not+deleted";

/**
 * The one unsettled state the wire can prove (issue #1002): a delete Remit
 * abandoned before it reached the server — most often because the Trash folder
 * the event named is gone — which handed the row back to the folder the server
 * still holds the message in.
 *
 * It gets a real Retry, not a report-only dead end: abandoning puts `status`
 * back to `active`, so the ordinary delete endpoint accepts the row and
 * re-drives it. A move that gave up leaves exactly the fields a move mid-retry
 * leaves, so it gets no treatment at all — no chip, no notice, no promise.
 */
export const Notice: Story = {
	render: () => (
		<div className="flex w-xl flex-col gap-3">
			<MessageSettlementNotice
				settlement="delete_failed"
				onRetry={() => undefined}
				reportHref={reportHref}
			/>
			<MessageSettlementNotice
				settlement="delete_failed"
				onRetry={() => undefined}
				retryPending
				reportHref={reportHref}
			/>
		</div>
	),
};

/** The same notice on the dark theme. */
export const NoticeDark: Story = {
	name: "Notice (dark)",
	parameters: { theme: "dark" },
	render: () => (
		<div className="flex w-xl flex-col gap-3">
			<MessageSettlementNotice
				settlement="delete_failed"
				onRetry={() => undefined}
				reportHref={reportHref}
			/>
		</div>
	),
};

/** The list-row chip, which carries the label alone — a row may nest no action. */
export const Badge: Story = {
	render: () => (
		<div className="flex items-center gap-2">
			<MessageSettlementBadge settlement="delete_failed" />
		</div>
	),
};
