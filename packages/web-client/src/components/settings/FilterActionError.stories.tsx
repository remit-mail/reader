import type { Meta, StoryObj } from "@storybook/react-vite";
import { ApiError } from "@/lib/api";
import { FilterActionError } from "./FilterActionError";

const meta: Meta<typeof FilterActionError> = {
	title: "Playground/Shipped/Settings/Filters/FilterActionError",
	component: FilterActionError,
	parameters: { layout: "padded" },
	decorators: [
		(Story) => (
			<div className="mx-auto max-w-md">
				<Story />
			</div>
		),
	],
	args: {
		onRetry: () => undefined,
		reportHref: () => "https://github.com/remit-mail/reader/issues/new",
	},
};
export default meta;

type Story = StoryObj<typeof FilterActionError>;

export const RefusedWithoutFolder: Story = {
	args: {
		title: "Couldn't turn the filter on",
		error: new ApiError(
			"This filter has no folder to move mail into yet. Wait for its folder to be created on the mail server, or pick a folder in the rule, then turn it on.",
			400,
		),
	},
};

export const ServerUnavailable: Story = {
	args: {
		title: "Couldn't turn the filter off",
		error: new ApiError("The server did not answer.", 503),
	},
};

export const RunNowRefused: Story = {
	args: {
		title: "Couldn't run Invoices over the inbox",
		error: new ApiError(
			"This filter is turned off or has expired. Turn it on to run it over the inbox.",
			400,
		),
	},
};
