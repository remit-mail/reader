import {
	ConfirmDialog,
	DialogBackdrop,
	Kbd,
	KEY_HINT_GROUPS,
	type Verb,
} from "@remit/ui";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { useEffect, useState } from "react";
import { expect, userEvent, within } from "storybook/test";
import { allThreads, q3Intelligence, q3Thread } from "../fixtures/workspace.js";
import { MailShell } from "../screens/mail-shell.js";

/**
 * The surfaces that open over a list, and which tier of the URL each one is
 * allowed to live in (#713, #722).
 *
 * The fragment carries panel visibility — the intelligence rail, the nav
 * slide-over, the shortcuts sheet — because a cold load of the address
 * reproduces those exactly. An overlay whose own copy is computed from what is
 * in memory does not qualify: `#confirm-delete` reloads into "Move 12 messages
 * to Trash?" over a selection that is gone. The stories below make that rule
 * executable rather than remembered, and hold the other half of it: the rail is
 * a pane, the sheet is modal over it, and one is never the other's alternative.
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
 * The shortcuts sheet as the app raises it: modal over the shell, dismissed by
 * Escape, and carrying copy that comes from the keymap rather than from
 * anything on screen — which is why it is addressable at all.
 */
function ShortcutsSheet({ onClose }: { onClose: () => void }) {
	useEffect(() => {
		const dismiss = (event: KeyboardEvent) => {
			if (event.key !== "Escape") return;
			event.preventDefault();
			onClose();
		};
		window.addEventListener("keydown", dismiss);
		return () => window.removeEventListener("keydown", dismiss);
	}, [onClose]);

	return (
		<div className="fixed inset-0 z-50 flex items-center justify-center">
			<DialogBackdrop label="Dismiss keyboard shortcuts" onDismiss={onClose} />
			<div
				aria-label="Keyboard shortcuts"
				aria-modal="true"
				className="relative z-10 max-h-[85vh] w-full max-w-2xl overflow-y-auto rounded-lg border border-line bg-surface p-6 shadow-lg"
				role="dialog"
			>
				<h2 className="mb-4 text-lg font-semibold text-fg">
					Keyboard shortcuts
				</h2>
				{KEY_HINT_GROUPS.map((group) => (
					<section className="mb-4" key={group.title}>
						<h3 className="mb-2 text-2xs uppercase tracking-wider text-fg-subtle">
							{group.title}
						</h3>
						{group.hints.map((hint) => (
							<div
								className="flex items-center justify-between py-0.5 text-sm text-fg-muted"
								key={`${hint.action}-${hint.keys.join()}`}
							>
								<span>{hint.description}</span>
								<span className="flex gap-1">
									{hint.keys.map((key) => (
										<Kbd key={key}>{key}</Kbd>
									))}
								</span>
							</div>
						))}
					</section>
				))}
			</div>
		</div>
	);
}

/** The rail with a sheet the reader can raise over it and dismiss again. */
function ReadingWithSheet() {
	const [sheetOpen, setSheetOpen] = useState(false);

	return (
		<div className="flex h-screen flex-col">
			<div className="flex shrink-0 items-center gap-2 border-b border-line bg-surface-sunken px-3 py-2">
				<button
					className="rounded-md border border-line px-2 py-1 text-xs text-fg"
					onClick={() => setSheetOpen(true)}
					type="button"
				>
					Keyboard shortcuts
				</button>
			</div>
			<div className="min-h-0 flex-1">
				<MailShell
					intelligence={q3Intelligence}
					listTitle="Inbox"
					overlay={
						sheetOpen ? (
							<ShortcutsSheet onClose={() => setSheetOpen(false)} />
						) : null
					}
					sections={inboxSections}
					selectedNavId="mbx_personal_inbox"
					selectedThreadId="thr_q3"
					thread={q3Thread}
				/>
			</div>
		</div>
	);
}

/**
 * The rail is a pane and the sheet is modal over it, so raising the sheet
 * cannot take the rail down. Modelled as one exclusive slot instead, `?`
 * unmounted the rail and dismissing the sheet never brought it back.
 */
export const SheetOpensOverTheRail: Story = {
	render: () => <ReadingWithSheet />,
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);

		await expect(await canvas.findByText("Intelligence")).toBeInTheDocument();

		await userEvent.click(
			canvas.getByRole("button", { name: "Keyboard shortcuts" }),
		);
		const sheet = await canvas.findByRole("dialog", {
			name: "Keyboard shortcuts",
		});
		await expect(sheet).toBeInTheDocument();
		await expect(canvas.getByText("Intelligence")).toBeInTheDocument();

		// Unrelated to either surface, and both are still where they were.
		await userEvent.keyboard("j");
		await expect(canvas.getByRole("dialog")).toBeInTheDocument();
		await expect(canvas.getByText("Intelligence")).toBeInTheDocument();

		await userEvent.keyboard("{Escape}");
		await expect(canvas.queryByRole("dialog")).toBeNull();
		await expect(canvas.getByText("Intelligence")).toBeInTheDocument();
	},
};

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
