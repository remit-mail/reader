import type { Meta, StoryObj } from "@storybook/react-vite";
import { ErrorBanner } from "./ErrorBanner";

/**
 * The soft, dismissible notification (#55). It sits over the toolbar and the
 * message list, so it is opaque and it names its own severity out loud rather
 * than leaving colour to carry the meaning.
 *
 * A failure the user cannot act on still gets an action link, prefilled, so
 * reporting it is one click instead of a form they have to assemble. The
 * hrefs below stand in for the real report URL, which the app builds from
 * build-time constants Storybook has no `define` for.
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

/** A mutation that failed, with the reason underneath. */
export const Failed: Story = {
	name: "Error",
	args: {
		severity: "error",
		title: "Couldn't move message",
		detail: "Connection reset by peer",
	},
};

/** Nothing more to say than the title. */
export const NoDetail: Story = {
	args: {
		severity: "error",
		title: "Couldn't move message",
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

/** The action link on the dark theme. */
export const WithActionLinkDark: Story = {
	name: "With Action Link (dark)",
	parameters: { theme: "dark" },
	args: WithActionLink.args,
};
