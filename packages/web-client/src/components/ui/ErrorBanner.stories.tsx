import type { Meta, StoryObj } from "@storybook/react-vite";
import { ErrorBanner } from "./ErrorBanner";

/**
 * The soft, dismissible notification (#55). It sits over the toolbar and the
 * message list, so it is opaque and it names its own severity out loud rather
 * than leaving colour to carry the meaning.
 *
 * Every error banner carries a prefilled report link, so reporting a failure
 * the user cannot act on is one click instead of a form they have to
 * assemble. The hrefs below stand in for the real report URL, which the app
 * builds from build-time constants Storybook has no `define` for.
 */
const meta: Meta<typeof ErrorBanner> = {
	title: "Components/ErrorBanner",
	component: ErrorBanner,
	parameters: { layout: "padded" },
	args: {
		id: "banner-1",
		onDismiss: () => undefined,
	},
};
export default meta;

type Story = StoryObj<typeof ErrorBanner>;

const REPORT_URL =
	"https://github.com/remit-mail/reader/issues/new?title=Spellcheck+stopped";

/** A mutation that failed, with the reason underneath and a way out. */
export const Failed: Story = {
	name: "Error",
	args: {
		severity: "error",
		title: "Couldn't move message",
		detail: "Connection reset by peer",
		action: { label: "Report an issue", href: REPORT_URL },
	},
};

/** Nothing more to say than the title — the report link still stands. */
export const NoDetail: Story = {
	args: {
		severity: "error",
		title: "Couldn't move message",
		action: { label: "Report an issue", href: REPORT_URL },
	},
};

/**
 * Report spam failing because the account has nowhere to file it. The reason
 * names the folder and the fix, so this one is actionable without the report
 * link — which is offered anyway, because the user should not have to decide.
 */
export const NoJunkFolder: Story = {
	args: {
		severity: "error",
		title: "Couldn't report this message as spam",
		detail:
			"This account has no Junk folder. Create one named Junk or Spam in your mail provider, then report this message again.",
		action: { label: "Report an issue", href: REPORT_URL },
	},
};

/** Something degraded rather than broke. */
export const Warning: Story = {
	args: {
		severity: "warning",
		title: "Draft saved locally",
		detail: "The server did not answer, so this draft has not been uploaded.",
	},
};

/** A statement of fact, not a problem. */
export const Info: Story = {
	args: {
		severity: "info",
		title: "Sync finished",
		detail: "1,204 messages are up to date.",
	},
};

/**
 * The spellchecker stopping (#707): the writer cannot fix this one, so the
 * banner says what stopped, what is happening instead, and offers the report
 * already filled in.
 */
export const WithActionLink: Story = {
	args: {
		severity: "warning",
		title: "Spellcheck stopped",
		detail:
			"Spellcheck for en is off: the checker could not start. Your browser is checking this message instead. Failed to fetch dynamically imported module.",
		action: { label: "Report this", href: REPORT_URL },
	},
};

/**
 * A delete refused because the message is still being moved on the mail server
 * (#845). Transient: the same press works once the move confirms, so the copy
 * says so rather than sending the user off to report a bug.
 */
export const PlacementInFlight: Story = {
	args: {
		severity: "warning",
		title: "Couldn't delete this message yet",
		detail:
			"It is still being moved on the mail server. Try again in a moment.",
		action: { label: "Report an issue", href: REPORT_URL },
	},
};

/**
 * The same refusal after the move gave up without confirming. Waiting will
 * never clear this one, so the remedy is a resync instead.
 */
export const PlacementUnverified: Story = {
	args: {
		severity: "warning",
		title: "Couldn't delete 4 messages yet",
		detail:
			"An earlier move never finished, so where this message sits is unknown. Sync the folder, then delete it again.",
		action: { label: "Report an issue", href: REPORT_URL },
	},
};

/** The action link on the dark theme. */
export const WithActionLinkDark: Story = {
	name: "With Action Link (dark)",
	parameters: { theme: "dark" },
	args: WithActionLink.args,
};
