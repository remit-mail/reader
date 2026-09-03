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
	"https://github.com/remit-mail/reader/issues/new?title=This+change+never+reached+the+mail+server";

/**
 * The two states a message can be in when its last IMAP mutation has not
 * settled (issue #1002). `in_flight` resolves itself, so it is stated quietly
 * and carries no action. `abandoned` does not: every mutating endpoint refuses
 * a row in that state and the sync path refuses to repair it, so the notice
 * says what happened and offers the prefilled issue link rather than a Retry
 * that would fail on every press.
 */
export const Notices: Story = {
	render: () => (
		<div className="flex w-xl flex-col gap-3">
			<MessageSettlementNotice settlement="in_flight" />
			<MessageSettlementNotice settlement="abandoned" reportHref={reportHref} />
		</div>
	),
};

/** The same notices on the dark theme. */
export const NoticesDark: Story = {
	name: "Notices (dark)",
	parameters: { theme: "dark" },
	render: () => (
		<div className="flex w-xl flex-col gap-3">
			<MessageSettlementNotice settlement="in_flight" />
			<MessageSettlementNotice settlement="abandoned" reportHref={reportHref} />
		</div>
	),
};

/** The list-row chip, which carries the label alone — a row may nest no action. */
export const Badges: Story = {
	render: () => (
		<div className="flex items-center gap-2">
			<MessageSettlementBadge settlement="in_flight" />
			<MessageSettlementBadge settlement="abandoned" />
		</div>
	),
};
