import type { Meta, StoryObj } from "@storybook/react";
import { ComposeActionBar } from "./compose-action-bar.js";
import { ComposeFormShell, composeModeLabels } from "./compose-form-shell.js";

const meta: Meta<typeof ComposeFormShell> = {
	title: "Mail/ComposeForm",
	component: ComposeFormShell,
	parameters: { layout: "fullscreen" },
};
export default meta;

type Story = StoryObj<typeof ComposeFormShell>;

const Header = ({ title }: { title: string }) => (
	<div className="space-y-1 border-b border-line px-3 py-2">
		<div className="text-xs font-semibold text-fg-muted">{title}</div>
		<div className="flex items-center gap-2 text-sm">
			<span className="w-12 text-fg-muted">To</span>
			<span>alex@example.com</span>
		</div>
		<div className="flex items-center gap-2 text-sm">
			<span className="w-12 text-fg-muted">Subject</span>
			<span>Q3 planning notes</span>
		</div>
	</div>
);

const Body = () => (
	<div className="min-h-[120px] px-3 py-2 text-sm">
		Hi Alex, here are the notes from today…
	</div>
);

const bar = (
	<ComposeActionBar
		onSend={() => undefined}
		onDiscard={() => undefined}
		sending={false}
		canSend={true}
		saveStatus="saved"
	/>
);

export const DesktopFull: Story = {
	name: "Desktop — full compose",
	render: () => (
		<div className="h-[560px] w-[560px] border border-line bg-canvas">
			<ComposeFormShell
				header={<Header title={composeModeLabels.new} />}
				actionBar={bar}
			>
				<Body />
			</ComposeFormShell>
		</div>
	),
};

export const InlineReply: Story = {
	name: "Inline reply",
	render: () => (
		<div className="flex h-[400px] w-[640px] max-h-[400px] flex-col border-t border-line bg-canvas">
			<ComposeFormShell
				header={<Header title={composeModeLabels.reply} />}
				quoted={
					<div className="border-l-2 border-line pl-3 text-xs text-fg-muted">
						On Tuesday, Alex wrote: …
					</div>
				}
				actionBar={bar}
			>
				<Body />
			</ComposeFormShell>
		</div>
	),
};

export const MobileSheet: Story = {
	name: "Mobile sheet — Send within viewport",
	globals: { viewport: { value: "mobile" } },
	render: () => (
		<div className="flex h-[95dvh] w-[390px] flex-col rounded-t-lg border border-line bg-canvas">
			<div className="mx-auto mt-2 mb-1 h-1.5 w-12 rounded-full bg-fg-muted/30" />
			<div className="border-b border-line px-4 py-2 text-base font-semibold">
				{composeModeLabels.new}
			</div>
			<div className="min-h-0 flex-1">
				<ComposeFormShell
					header={<Header title={composeModeLabels.new} />}
					actionBar={bar}
				>
					<Body />
				</ComposeFormShell>
			</div>
		</div>
	),
};
