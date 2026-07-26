import type { Meta, StoryObj } from "@storybook/react";
import { useState } from "react";
import {
	type MoveMailboxOption,
	MoveMailboxPicker,
} from "./move-mailbox-picker.js";

const mailboxes: MoveMailboxOption[] = [
	{ id: "inbox", label: "Inbox", isCurrent: true },
	{ id: "archive", label: "Archive" },
	{ id: "trash", label: "Trash" },
	{ id: "spam", label: "Spam" },
	{ id: "receipts", label: "Receipts", searchValue: "finance/receipts" },
	{ id: "travel", label: "Travel", searchValue: "finance/travel" },
	{ id: "newsletters", label: "Newsletters" },
];

const manyMailboxes: MoveMailboxOption[] = [
	{ id: "inbox", label: "Inbox", isCurrent: true },
	...Array.from({ length: 24 }, (_, i) => ({
		id: `folder-${i}`,
		label: `Project ${String(i + 1).padStart(2, "0")}`,
	})),
];

const meta: Meta<typeof MoveMailboxPicker> = {
	title: "Mail/MoveMailboxPicker",
	component: MoveMailboxPicker,
	parameters: { layout: "centered" },
	decorators: [
		(Story) => (
			<div className="w-72 max-h-96 overflow-hidden rounded-md border border-line bg-surface shadow-lg">
				<Story />
			</div>
		),
	],
};
export default meta;

type Story = StoryObj<typeof MoveMailboxPicker>;

const Picker = ({ options }: { options: MoveMailboxOption[] }) => {
	const [moved, setMoved] = useState<string | null>(null);
	return (
		<div className="flex flex-col">
			<MoveMailboxPicker mailboxes={options} onSelect={setMoved} />
			{moved && (
				<p className="border-t border-line px-3 py-2 text-xs text-fg-muted">
					Moved to {moved}
				</p>
			)}
		</div>
	);
};

export const Default: Story = {
	name: "Default (current folder marked)",
	render: () => <Picker options={mailboxes} />,
};

export const ManyMailboxes: Story = {
	name: "Many mailboxes (scrolls)",
	render: () => <Picker options={manyMailboxes} />,
};

export const Empty: Story = {
	name: "Empty list",
	render: () => <Picker options={[]} />,
};

export const Autofocus: Story = {
	name: "Autofocus search (mobile sheet)",
	render: () => (
		<MoveMailboxPicker mailboxes={mailboxes} onSelect={() => {}} autoFocus />
	),
};

let createdSeq = 0;
const mockCreateFolder = (name: string): Promise<MoveMailboxOption> =>
	new Promise((resolve) => {
		createdSeq += 1;
		setTimeout(
			() => resolve({ id: `created-${createdSeq}`, label: name }),
			400,
		);
	});

const CreatePicker = () => {
	const [moved, setMoved] = useState<string | null>(null);
	return (
		<div className="flex flex-col">
			<MoveMailboxPicker
				mailboxes={mailboxes}
				onSelect={setMoved}
				onCreateFolder={mockCreateFolder}
			/>
			{moved && (
				<p className="border-t border-line px-3 py-2 text-xs text-fg-muted">
					Moved to {moved}
				</p>
			)}
		</div>
	);
};

/**
 * With `onCreateFolder` wired, a search that names no existing folder offers a
 * create-and-move row at the bottom. Type e.g. "Taxes", then pick the create
 * row — the folder is created and the message moved into it in one step.
 */
export const CreateAndMove: Story = {
	name: "Create folder from search",
	render: () => <CreatePicker />,
};

/**
 * Type a folder name into the search box and press the create-and-move row —
 * used by the pending and error stories so each lands in its state without a
 * manual click-through.
 */
async function typeAndCreate(canvasElement: HTMLElement, folderName: string) {
	const setInputValue = Object.getOwnPropertyDescriptor(
		HTMLInputElement.prototype,
		"value",
	)?.set;
	const input = canvasElement.querySelector<HTMLInputElement>(
		'input[type="search"]',
	);
	if (!input) return;
	setInputValue?.call(input, folderName);
	input.dispatchEvent(new Event("input", { bubbles: true }));
	const createButton = Array.from(
		canvasElement.querySelectorAll<HTMLButtonElement>("button"),
	).find((button) => button.textContent?.includes(`Create "${folderName}"`));
	createButton?.click();
}

/** Mirrors the web-client wait's honest timeout copy. */
const TIMEOUT_MESSAGE =
	"The folder was created but the mail server hasn't confirmed it yet, so nothing was attached to it. It's in your folder list — try again in a moment.";

const tick = () => new Promise((resolve) => setTimeout(resolve, 60));

const neverResolvesCreateFolder = (): Promise<MoveMailboxOption> =>
	new Promise<MoveMailboxOption>(() => undefined);

const rejectingCreateFolder =
	(message: string) => (): Promise<MoveMailboxOption> =>
		Promise.reject(new Error(message));

/** Rejects the first attempt, resolves the retry — the resume the hook performs. */
const failThenSucceedCreateFolder = () => {
	let attempts = 0;
	return (name: string): Promise<MoveMailboxOption> => {
		attempts += 1;
		return attempts === 1
			? Promise.reject(new Error(TIMEOUT_MESSAGE))
			: Promise.resolve({ id: "mbx-created", label: name });
	};
};

/** Never resolves on its own; rejects with an AbortError when the signal aborts. */
const abortAwareCreateFolder = (
	_name: string,
	signal?: AbortSignal,
): Promise<MoveMailboxOption> =>
	new Promise<MoveMailboxOption>((_resolve, reject) => {
		signal?.addEventListener("abort", () =>
			reject(new DOMException("Aborted", "AbortError")),
		);
	});

/**
 * The move is a dependent write on the folder: the create-and-move row does not
 * resolve until the mail server confirms the folder, so the move never races the
 * folder into existence. The wait shows as "Creating folder…".
 */
export const CreateFolderInFlight: Story = {
	name: "Create folder — waiting for the server",
	render: () => (
		<MoveMailboxPicker
			mailboxes={mailboxes}
			onSelect={() => undefined}
			onCreateFolder={neverResolvesCreateFolder}
		/>
	),
	play: async ({ canvasElement }) => {
		await typeAndCreate(canvasElement, "Taxes");
	},
};

/**
 * The folder create failed on the mail server. No move runs; the error is shown
 * inline and the create row can be pressed again to retry.
 */
export const CreateFolderFailed: Story = {
	name: "Create folder — failed (retry)",
	render: () => (
		<MoveMailboxPicker
			mailboxes={mailboxes}
			onSelect={() => undefined}
			onCreateFolder={rejectingCreateFolder(
				"The folder couldn't be created on the mail server. Please try again.",
			)}
		/>
	),
	play: async ({ canvasElement }) => {
		await typeAndCreate(canvasElement, "Taxes");
	},
};

/**
 * The folder create was never confirmed within the wait bound — the timeout is
 * named distinctly, and no move runs.
 */
export const CreateFolderTimedOut: Story = {
	name: "Create folder — timed out (retry)",
	render: () => (
		<MoveMailboxPicker
			mailboxes={mailboxes}
			onSelect={() => undefined}
			onCreateFolder={rejectingCreateFolder(TIMEOUT_MESSAGE)}
		/>
	),
	play: async ({ canvasElement }) => {
		await typeAndCreate(canvasElement, "Taxes");
	},
};

/**
 * Retry is a resume: the first create times out, and pressing the create row
 * again with the same name resolves and moves — the hook re-waits on the folder
 * it already made rather than re-creating it.
 */
export const CreateFolderRetrySucceeds: Story = {
	name: "Create folder — retry resumes and moves",
	render: () => {
		const RetryStage = () => {
			const [moved, setMoved] = useState<string | null>(null);
			return (
				<div className="flex flex-col">
					<MoveMailboxPicker
						mailboxes={mailboxes}
						onSelect={setMoved}
						onCreateFolder={failThenSucceedCreateFolder()}
					/>
					{moved && (
						<p className="border-t border-line px-3 py-2 text-xs text-fg-muted">
							Moved to {moved}
						</p>
					)}
				</div>
			);
		};
		return <RetryStage />;
	},
	play: async ({ canvasElement }) => {
		await typeAndCreate(canvasElement, "Taxes");
		await tick();
		const retry = Array.from(
			canvasElement.querySelectorAll<HTMLButtonElement>("button"),
		).find((button) => button.textContent?.includes('Create "Taxes"'));
		retry?.click();
	},
};

/**
 * Closing the picker while "Creating folder…" is in flight aborts the wait: the
 * create promise rejects with an AbortError, so a folder that would confirm later
 * never fires the move after the picker is gone. Here "Close picker" unmounts it
 * mid-wait; no "Moved to" line appears.
 */
export const CreateFolderClosedMidWait: Story = {
	name: "Create folder — closing aborts the move",
	render: () => {
		const AbortStage = () => {
			const [open, setOpen] = useState(true);
			const [moved, setMoved] = useState<string | null>(null);
			return (
				<div className="flex flex-col">
					<button
						type="button"
						onClick={() => setOpen(false)}
						className="border-b border-line px-3 py-2 text-left text-xs text-fg-muted"
					>
						Close picker
					</button>
					{open && (
						<MoveMailboxPicker
							mailboxes={mailboxes}
							onSelect={setMoved}
							onCreateFolder={abortAwareCreateFolder}
						/>
					)}
					{moved && (
						<p className="border-t border-line px-3 py-2 text-xs text-fg-muted">
							Moved to {moved}
						</p>
					)}
				</div>
			);
		};
		return <AbortStage />;
	},
	play: async ({ canvasElement }) => {
		await typeAndCreate(canvasElement, "Taxes");
		await tick();
		const close = Array.from(
			canvasElement.querySelectorAll<HTMLButtonElement>("button"),
		).find((button) => button.textContent?.trim() === "Close picker");
		close?.click();
	},
};
