import {
	type AddressEntry,
	ComposeActionBar,
	ComposeAddressField,
	ComposeBodySkeleton,
	ComposeFormShell,
	ComposeHeader,
	ComposeSubjectField,
	ConfirmDialog,
	composeHeaderSummary,
	DialogBackdrop,
	inboxFilterConfig,
	Kbd,
	KEY_HINT_GROUPS,
	OutboxRow,
	type Verb,
} from "@remit/ui";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { useEffect, useState } from "react";
import { expect, userEvent, within } from "storybook/test";
import {
	allThreads,
	flaggedThreads,
	q3Intelligence,
	q3Thread,
} from "../fixtures/workspace.js";
import {
	DESKTOP_WIDTH,
	framedAt,
	PHONE_WIDTH,
	phoneFrame,
	phoneParams,
} from "../lib/story-frame.js";
import { MailShell } from "../screens/mail-shell.js";

/**
 * The surfaces that open over a list: which tier of the URL each one lives in,
 * and which of them can be up at the same time (#713, #719, #722).
 *
 * The fragment carries panel visibility — the intelligence rail, the nav
 * slide-over, the shortcuts sheet — because a cold load of the address
 * reproduces those exactly. An overlay whose own copy is computed from what is
 * in memory does not qualify: `#confirm-delete` reloads into "Move 12 messages
 * to Trash?" over a selection that is gone. The stories below make that rule
 * executable rather than remembered, and hold the other half of it: the rail is
 * a pane, the sheet is modal over it, and one is never the other's alternative.
 *
 * Compose is the path tier's side of the same question. It used to be a flag
 * only the folder view rendered anything off, so the daily brief, Starred and
 * the outbox carried a Compose button that opened nothing; it is a route under
 * each list now, and one story per list is the precedence table. The writing
 * surface itself is `Flows/Compose` — these stories are about the pane it lands
 * in, so the body here is the skeleton.
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
		<div className="flex h-full flex-col">
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
	// Framed, not left to the runner's viewport: the rail is a pane of the widest
	// tier, and the shell reflows off its own container.
	decorators: [framedAt(DESKTOP_WIDTH)],
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

const FromRow = () => (
	<div className="flex items-center gap-2 px-3 py-1.5 text-sm text-fg-muted">
		<span>From</span>
		<span className="text-fg">alice@northwind.example</span>
	</div>
);

/**
 * The compose surface as a pane: the header the message is addressed with, and
 * the action bar under it.
 */
const ComposeSurface = ({
	draft,
}: {
	/** The draft it opened on, for the stories where it was resumed. */
	draft?: { to: string; subject: string };
}) => {
	const [toAddresses, setToAddresses] = useState<AddressEntry[]>(
		draft ? [{ email: draft.to, displayName: undefined }] : [],
	);
	const [subject, setSubject] = useState(draft?.subject ?? "");

	return (
		<ComposeFormShell
			header={
				<ComposeHeader
					onExpand={() => undefined}
					summary={composeHeaderSummary({
						to: toAddresses,
						cc: [],
						bcc: [],
						subject,
					})}
					from={<FromRow />}
					to={
						<ComposeAddressField
							label="To"
							addresses={toAddresses}
							onChange={setToAddresses}
							placeholder="Recipients"
						/>
					}
					subject={
						<ComposeSubjectField value={subject} onChange={setSubject} />
					}
					onShowCc={() => undefined}
					onShowBcc={() => undefined}
				/>
			}
			actionBar={
				<ComposeActionBar
					send={
						toAddresses.length === 0
							? { status: "blocked", reason: "Add at least one recipient." }
							: { status: "ready" }
					}
					onSend={() => undefined}
					onBlocked={() => undefined}
					onDiscard={() => undefined}
					saveStatus="idle"
				/>
			}
		>
			<ComposeBodySkeleton />
		</ComposeFormShell>
	);
};

const brief = {
	selectedNavId: "brief",
	listTitle: "Daily brief",
	sections: [{ id: "brief", threads: allThreads }],
	briefFilters: true,
};

const starred = {
	selectedNavId: "flagged",
	listTitle: "Starred",
	sections: [{ id: "flagged", threads: flaggedThreads }],
};

const mailbox = {
	selectedNavId: "mbx_personal_inbox",
	listTitle: "Inbox",
	unreadCount: 9,
	sections: [{ id: "inbox", threads: allThreads }],
	preset: inboxFilterConfig(),
};

/** Outbox rows that never went out, which are the ones offering Edit. */
const outboxRows = [
	{
		to: "priya@northwind.example",
		subject: "Q3 numbers, revised",
		time: "09:14",
		status: "blocked" as const,
		error: "No SMTP server configured for this account",
	},
	{
		to: "dev@northwind.example",
		subject: "Re: staging deploy",
		time: "Tue",
		status: "failed" as const,
		error: "Connection refused",
	},
];

/**
 * Compose over the daily brief, where the press used to do nothing at all.
 *
 * Then a query typed into search, which is the step that matters: that is what
 * used to summon a surface opened earlier over a view that could not mount it.
 * So the surface is asserted, something unrelated happens, and it is asserted
 * again — a single check straight after the press passes on the broken code.
 */
export const ComposeThenTypeInSearch: Story = {
	name: "Compose over the brief, then type in search",
	render: function ComposeThenTypeInSearchRender() {
		const [composing, setComposing] = useState(false);
		return (
			<MailShell
				{...brief}
				onCompose={() => setComposing(true)}
				reading={composing ? <ComposeSurface /> : undefined}
			/>
		);
	},
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);

		await userEvent.click(canvas.getByRole("button", { name: /^Compose/ }));

		await expect(canvas.getByLabelText("To:")).toBeVisible();

		const search = canvas.getByLabelText("Search mail");
		await userEvent.type(search, "invoice");

		// Nothing about the surface moved on the search: one composer, still the
		// one that was opened, and the caret in the field being typed into.
		await expect(search).toHaveFocus();
		await expect(canvas.getAllByLabelText("To:")).toHaveLength(1);
	},
};

/**
 * The outbox, and "Edit as draft" on a row that never went out.
 *
 * The one entry point that opens the composer on a message that already exists,
 * so it is the one that says which draft is being written. Its absence from
 * this file is why a composer opening on the wrong draft went unseen.
 */
export const EditADraftFromTheOutbox: Story = {
	name: "Edit as draft, from the outbox",
	render: function EditADraftFromTheOutboxRender() {
		const [editing, setEditing] = useState<(typeof outboxRows)[number]>();
		return (
			<MailShell
				selectedNavId="outbox"
				listTitle="Outbox"
				readingPane={editing ? "default" : "off"}
				list={
					<section className="flex h-full w-full flex-col bg-surface">
						<header className="flex h-pane-header shrink-0 items-center border-b border-line px-row-inset text-sm font-semibold text-fg">
							Outbox
						</header>
						<div className="flex-1 overflow-y-auto">
							{outboxRows.map((row) => (
								<OutboxRow
									key={row.subject}
									recipients={row.to}
									subject={row.subject}
									time={row.time}
									status={row.status}
									error={row.error}
									selected={editing?.subject === row.subject}
									onSelect={() => undefined}
									onEdit={() => setEditing(row)}
									onDelete={() => undefined}
								/>
							))}
						</div>
					</section>
				}
				reading={
					editing ? (
						<ComposeSurface
							draft={{ to: editing.to, subject: editing.subject }}
						/>
					) : undefined
				}
			/>
		);
	},
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);

		// Every unsent row offers it, so the press has to name which one — which is
		// the whole point: the composer opens on the draft it was asked for.
		const [first] = canvas.getAllByRole("button", { name: "Edit as draft" });
		if (!first) throw new Error("no outbox row offers Edit as draft");
		await userEvent.click(first);

		// The composer opens on the row it was pressed on, not on a blank message
		// and not on whatever the last composer was writing.
		const subject = canvas.getByPlaceholderText("Subject");
		await expect(subject).toHaveValue(outboxRows[0]?.subject ?? "");

		// Assert again with the list still beside it: the other unsent row is
		// there, and the composer is still on the one that was asked for.
		await expect(canvas.getByText(outboxRows[1]?.subject ?? "")).toBeVisible();
		await expect(subject).toHaveValue(outboxRows[0]?.subject ?? "");
	},
};

/** Compose over Starred, the second list that had nowhere to show it. */
export const ComposeOverStarred: Story = {
	name: "Compose over Starred",
	render: () => <MailShell {...starred} reading={<ComposeSurface />} />,
};

/** Compose over a folder: the reading pane, with the list still beside it. */
export const ComposeOverAFolder: Story = {
	name: "Compose over a folder",
	render: () => <MailShell {...mailbox} reading={<ComposeSurface />} />,
};

/**
 * Phone width (390 px): there is no reading pane to take, so the surface is the
 * single pane and the list is behind it rather than beside it.
 */
export const ComposeOnThePhone: Story = {
	name: "Compose on the phone",
	parameters: phoneParams,
	decorators: [phoneFrame],
	render: () => (
		<MailShell {...brief} width={PHONE_WIDTH} list={<ComposeSurface />} />
	),
};
