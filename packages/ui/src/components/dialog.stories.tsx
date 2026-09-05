import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { expect, userEvent, within } from "storybook/test";
import { Button } from "./button.js";
import { Dialog } from "./dialog.js";

const meta: Meta<typeof Dialog> = {
	title: "Components/Dialog",
	component: Dialog,
	parameters: { layout: "fullscreen" },
};
export default meta;

type Story = StoryObj<typeof Dialog>;

function Demo({ initialOpen = true }: { initialOpen?: boolean }) {
	const [open, setOpen] = useState(initialOpen);
	return (
		<div className="h-dvh bg-canvas p-6">
			<Button variant="secondary" onClick={() => setOpen(true)}>
				Open dialog
			</Button>
			<Dialog open={open} onClose={() => setOpen(false)} title="Move message">
				<div className="flex flex-col gap-3 p-4">
					<input
						aria-label="Folder"
						placeholder="Folder"
						className="h-9 rounded-md border border-line bg-surface px-2 text-sm text-fg"
					/>
					<div className="flex justify-end gap-2">
						<Button variant="ghost" onClick={() => setOpen(false)}>
							Cancel
						</Button>
						<Button onClick={() => setOpen(false)}>Move</Button>
					</div>
				</div>
			</Dialog>
		</div>
	);
}

export const Default: Story = {
	render: () => <Demo />,
};

/**
 * The dialog claims `aria-modal`, so the page behind it is hidden from a screen
 * reader and the keyboard has to agree: focus opens on the first control, Tab
 * off the last wraps to the first, Shift+Tab off the first wraps to the last,
 * and neither reaches the button behind the scrim.
 */
export const TrapsTabAtBothEdges: Story = {
	render: () => <Demo />,
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		const first = canvas.getByLabelText("Folder");
		const last = canvas.getByRole("button", { name: "Move" });
		const opener = canvas.getByRole("button", { name: "Open dialog" });

		await expect(first).toHaveFocus();

		await userEvent.tab();
		await expect(canvas.getByRole("button", { name: "Cancel" })).toHaveFocus();
		await userEvent.tab();
		await expect(last).toHaveFocus();

		await userEvent.tab();
		await expect(first).toHaveFocus();
		await expect(opener).not.toHaveFocus();

		await userEvent.tab({ shift: true });
		await expect(last).toHaveFocus();
		await expect(opener).not.toHaveFocus();
	},
};

/**
 * Escape dismisses the dialog and hands focus back to whatever opened it, so a
 * keyboard user is never left parked on a surface that has gone.
 */
export const EscapeReturnsFocus: Story = {
	render: () => <Demo initialOpen={false} />,
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		const opener = canvas.getByRole("button", { name: "Open dialog" });

		await userEvent.click(opener);
		await expect(canvas.getByLabelText("Folder")).toHaveFocus();

		await userEvent.keyboard("{Escape}");
		await expect(canvas.queryByRole("dialog")).toBeNull();
		await expect(opener).toHaveFocus();
	},
};
