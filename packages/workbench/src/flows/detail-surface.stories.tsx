import { ConfirmDialog, type Verb } from "@remit/ui";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { expect, userEvent, within } from "storybook/test";
import { allThreads } from "../fixtures/workspace.js";
import { MailShell } from "../screens/mail-shell.js";

/**
 * The surfaces that open over a list, and which tier of the URL each one is
 * allowed to live in (#713, #722).
 *
 * The fragment carries panel visibility — the intelligence rail, the nav
 * slide-over, the shortcuts sheet — because a cold load of the address
 * reproduces those exactly. An overlay whose own copy is computed from what is
 * in memory does not qualify: `#confirm-delete` reloads into "Move 12 messages
 * to Trash?" over a selection that is gone. The story below is that rule made
 * executable rather than remembered.
 *
 * Every story follows the same shape: assert the surface, do something
 * unrelated, assert it again. A single assertion straight after the click
 * passes on code that only queued the work.
 */
const meta: Meta = {
	title: "Flows/Detail surface",
	parameters: { layout: "fullscreen" },
};
export default meta;

type Story = StoryObj;

const inboxSections = [{ id: "inbox", threads: allThreads }];
const ticked = allThreads.slice(0, 12).map((thread) => thread.id);

/**
 * The confirm as the app opens it: a title counted off the rows ticked when the
 * verb was pressed, so the dialog cannot be reconstructed from an address alone.
 */
function BulkDeleteSurface() {
	const [pendingCount, setPendingCount] = useState<number | undefined>(
		undefined,
	);
	const dismiss = () => setPendingCount(undefined);

	const handleVerb = (verb: Verb, selected: ReadonlySet<string>) => {
		if (verb !== "delete") return;
		setPendingCount(selected.size);
	};

	return (
		<MailShell
			listTitle="Inbox"
			selectedNavId="mbx_personal_inbox"
			sections={inboxSections}
			selectedIds={ticked}
			onVerb={handleVerb}
			overlay={
				<ConfirmDialog
					isOpen={pendingCount !== undefined}
					title={`Move ${pendingCount} messages to Trash?`}
					confirmLabel="Move to Trash"
					destructive
					onConfirm={dismiss}
					onCancel={dismiss}
				/>
			}
		/>
	);
}

/** A reload, as far as the surfaces are concerned: everything held in memory goes. */
function ReloadHarness() {
	const [generation, setGeneration] = useState(0);

	return (
		<div className="flex h-screen flex-col">
			<div className="flex shrink-0 items-center gap-2 border-b border-line bg-surface-sunken px-3 py-2">
				<button
					type="button"
					className="rounded-md border border-line px-2 py-1 text-xs text-fg"
					data-testid="reload"
					onClick={() => setGeneration((previous) => previous + 1)}
				>
					Reload the address
				</button>
			</div>
			<div className="min-h-0 flex-1">
				<BulkDeleteSurface key={generation} />
			</div>
		</div>
	);
}

/**
 * The bulk-delete confirm is not URL state, and this is what says so: open it
 * over twelve ticked rows, reload, and the dialog is gone. A fragment carrying
 * it would bring the title back over a selection of nothing.
 */
export const BulkDeleteConfirmHasASelection: Story = {
	render: () => <ReloadHarness />,
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);

		await expect(
			await canvas.findByText("12 messages selected"),
		).toBeInTheDocument();
		await userEvent.click(
			canvas.getByRole("button", { name: "Move selected messages to Trash" }),
		);

		const dialog = await canvas.findByRole("dialog");
		await expect(
			within(dialog).getByText("Move 12 messages to Trash?"),
		).toBeInTheDocument();

		// Unrelated to the dialog, and it is still up afterwards: a confirmation
		// that a later keystroke dismisses is a confirmation nobody read.
		await userEvent.keyboard("j");
		await expect(canvas.getByRole("dialog")).toBeInTheDocument();

		await userEvent.click(canvas.getByTestId("reload"));

		await expect(
			await canvas.findByText("12 messages selected"),
		).toBeInTheDocument();
		await expect(canvas.queryByRole("dialog")).toBeNull();
	},
};
