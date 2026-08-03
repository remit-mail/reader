import type { Meta, StoryObj } from "@storybook/react";
import { RefreshButton } from "./refresh-button.js";

const meta: Meta<typeof RefreshButton> = {
	title: "Mail/RefreshButton",
	component: RefreshButton,
	args: {
		label: "Refresh inbox",
		onRefresh: () => undefined,
	},
};
export default meta;

type Story = StoryObj<typeof RefreshButton>;

/** At rest, nothing to report. */
export const Idle: Story = {
	args: { state: "idle" },
};

/** The background poll found new mail; the dot is the whole message — nothing
 * reloads until this is clicked. */
export const NewMailAvailable: Story = {
	args: { state: "idle", hasUpdate: true },
};

/** A sync round is in flight — the glyph spins and the button won't stack a
 * second click on top of it. */
export const Refreshing: Story = {
	args: { state: "refreshing" },
};

/** Confirms the refresh landed with nothing left unresolved. */
export const Success: Story = {
	args: { state: "success" },
};

/** The refresh could not be confirmed — a real reason in the tooltip and the
 * accessible name, and clicking retries the same action. */
export const Failed: Story = {
	args: {
		state: "error",
		errorMessage: "Couldn't reach the server — check your connection",
	},
};

/** All four states side by side. */
export const AllStates: Story = {
	render: (args) => (
		<div className="flex items-center gap-4 p-4">
			<div className="flex flex-col items-center gap-1 text-2xs text-fg-muted">
				<RefreshButton {...args} state="idle" />
				Idle
			</div>
			<div className="flex flex-col items-center gap-1 text-2xs text-fg-muted">
				<RefreshButton {...args} state="idle" hasUpdate />
				New mail
			</div>
			<div className="flex flex-col items-center gap-1 text-2xs text-fg-muted">
				<RefreshButton {...args} state="refreshing" />
				Refreshing
			</div>
			<div className="flex flex-col items-center gap-1 text-2xs text-fg-muted">
				<RefreshButton {...args} state="success" />
				Success
			</div>
			<div className="flex flex-col items-center gap-1 text-2xs text-fg-muted">
				<RefreshButton
					{...args}
					state="error"
					errorMessage="Couldn't reach the server"
				/>
				Failed
			</div>
		</div>
	),
};
