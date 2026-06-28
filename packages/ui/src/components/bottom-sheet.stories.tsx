import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { BottomSheet } from "./bottom-sheet.js";
import { Button } from "./button.js";

const meta: Meta<typeof BottomSheet> = {
	title: "Components/BottomSheet",
	component: BottomSheet,
	parameters: { layout: "fullscreen" },
	decorators: [
		(Story) => (
			<div className="relative mx-auto h-dvh w-full shrink-0 overflow-hidden bg-surface sm:my-6 sm:h-[640px] sm:w-[390px] sm:rounded-[2rem] sm:border sm:border-line sm:shadow-sm">
				<Story />
			</div>
		),
	],
};
export default meta;

type Story = StoryObj<typeof BottomSheet>;

function Demo() {
	const [open, setOpen] = useState(true);
	return (
		<div className="relative h-full overflow-hidden bg-surface">
			<div className="divide-y divide-line opacity-50">
				{Array.from({ length: 9 }).map((_, i) => (
					<div
						// biome-ignore lint/suspicious/noArrayIndexKey: static skeleton rows
						key={i}
						className="flex items-start gap-3 px-row-inset py-2.5"
					>
						<div className="mt-0.5 size-7 shrink-0 rounded-full bg-surface-sunken" />
						<div className="min-w-0 flex-1 space-y-1">
							<div className="h-2.5 w-1/3 rounded bg-surface-sunken" />
							<div className="h-2 w-2/3 rounded bg-surface-sunken" />
						</div>
					</div>
				))}
			</div>
			{!open && (
				<Button
					variant="primary"
					onClick={() => setOpen(true)}
					className="absolute inset-x-0 bottom-0 m-3 h-11 font-semibold"
				>
					Open sheet
				</Button>
			)}
			<BottomSheet open={open} onClose={() => setOpen(false)}>
				<div className="px-row-inset py-6">
					<h2 className="text-sm font-semibold text-fg">Action sheet</h2>
					<p className="mt-1 text-xs text-fg-subtle">
						Drag the grabber down or tap outside to dismiss.
					</p>
					<Button
						variant="primary"
						onClick={() => setOpen(false)}
						className="mt-4 h-11 w-full font-semibold"
					>
						Got it
					</Button>
				</div>
			</BottomSheet>
		</div>
	);
}

export const Default: Story = {
	render: () => <Demo />,
};
