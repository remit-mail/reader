import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { Button } from "./button.js";
import { FieldLabel } from "./field-label.js";
import { Input } from "./input.js";
import { SlidePanel } from "./slide-panel.js";

const meta: Meta<typeof SlidePanel> = {
	title: "Components/SlidePanel",
	component: SlidePanel,
	parameters: { layout: "fullscreen" },
};
export default meta;

type Story = StoryObj<typeof SlidePanel>;

const backdropRows = Array.from({ length: 12 }, (_, i) => `Row ${i + 1}`);

const Backdrop = () => (
	<div className="h-dvh space-y-3 bg-canvas p-6">
		<h1 className="text-md font-semibold text-fg">Screen behind the panel</h1>
		{backdropRows.map((row) => (
			<div
				key={row}
				className="rounded-sm border border-line bg-surface px-4 py-3 text-sm text-fg-muted"
			>
				{row}
			</div>
		))}
	</div>
);

const Body = () => (
	<div className="space-y-4">
		<div>
			<FieldLabel htmlFor="slide-panel-email">Email address</FieldLabel>
			<Input id="slide-panel-email" placeholder="alice@example.com" />
		</div>
		<div>
			<FieldLabel htmlFor="slide-panel-name">Display name</FieldLabel>
			<Input id="slide-panel-name" placeholder="Alice" />
		</div>
	</div>
);

const Footer = ({ onClose }: { onClose: () => void }) => (
	<>
		<Button variant="secondary" size="sm" onClick={onClose}>
			Cancel
		</Button>
		<Button variant="primary" size="sm">
			Save
		</Button>
	</>
);

/** Open: a fixed-width column at the right edge, the screen behind it dimmed. */
export const Open: Story = {
	globals: { viewport: { value: "desktop" } },
	render: () => (
		<>
			<Backdrop />
			<SlidePanel isOpen onClose={() => {}} title="Add Account" footer={null}>
				<Body />
			</SlidePanel>
		</>
	),
};

/**
 * Closed. The panel stays mounted so it can animate, so this is the state that
 * has to be provably invisible: a closed panel that is not pushed off-canvas
 * takes over the whole screen (#57).
 */
export const Closed: Story = {
	globals: { viewport: { value: "desktop" } },
	render: () => (
		<>
			<Backdrop />
			<SlidePanel
				isOpen={false}
				onClose={() => {}}
				title="Add Account"
				footer={null}
			>
				<Body />
			</SlidePanel>
		</>
	),
};

/** On a phone the panel owns the full width. */
export const Phone: Story = {
	globals: { viewport: { value: "mobile" } },
	render: () => (
		<>
			<Backdrop />
			<SlidePanel isOpen onClose={() => {}} title="Add Account" footer={null}>
				<Body />
			</SlidePanel>
		</>
	),
};

/** Opening and closing from the screen behind it. */
export const Interactive: Story = {
	globals: { viewport: { value: "desktop" } },
	render: function Render() {
		const [open, setOpen] = useState(false);
		return (
			<>
				<div className="h-dvh space-y-3 bg-canvas p-6">
					<Button variant="primary" size="sm" onClick={() => setOpen(true)}>
						Add account
					</Button>
					<Backdrop />
				</div>
				<SlidePanel
					isOpen={open}
					onClose={() => setOpen(false)}
					title="Add Account"
					footer={<Footer onClose={() => setOpen(false)} />}
				>
					<Body />
				</SlidePanel>
			</>
		);
	},
};
