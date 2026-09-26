import type { Meta, StoryObj } from "@storybook/react-vite";
import { ApiError } from "@/lib/api";
import { FilterToggleError } from "./FilterToggleError";

const meta: Meta<typeof FilterToggleError> = {
	title: "Playground/Shipped/Settings/Filters/FilterToggleError",
	component: FilterToggleError,
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

type Story = StoryObj<typeof FilterToggleError>;

export const RefusedWithoutFolder: Story = {
	args: {
		enabling: true,
		error: new ApiError(
			"This filter has no folder to move mail into yet. Wait for its folder to be created on the mail server, or pick a folder in the rule, then turn it on.",
			400,
		),
	},
};

export const ServerUnavailable: Story = {
	args: {
		enabling: false,
		error: new ApiError("The server did not answer.", 503),
	},
};
