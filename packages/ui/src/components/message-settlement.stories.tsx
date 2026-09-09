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
 * A mutation Remit gave up on (issue #1002), named by the row itself (#1229).
 *
 * A delete gets a real Retry, not a report-only dead end: giving up puts
 * `status` back to `active`, so the ordinary delete endpoint accepts the row
 * and re-drives it. A move cannot retry that way — the destination the give-up
 * discarded is recorded nowhere — so its way out is the same folder picker
 * every other move goes through, passed in as `action`. Naming the wrong one
 * is the defect this replaces: a move that handed back rendered the delete
 * copy, under a button that deleted the message.
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
			<MessageSettlementNotice
				settlement="move_failed"
				action={
					<button type="button" className="font-medium text-accent">
						Move again
					</button>
				}
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
			<MessageSettlementBadge settlement="move_failed" />
		</div>
	),
};
