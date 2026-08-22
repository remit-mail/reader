import type { Meta, StoryObj } from "@storybook/react-vite";
import { EmptyTrashBar } from "@/components/mail/EmptyTrashBar";

/**
 * Emptying Trash from the mailbox pane, and the three refusals the server can
 * answer with (#847).
 *
 * The strip sits where the Spam rescue banner sits — above the list, in flow —
 * and the button always acts. Nothing here is pre-refused from what the client
 * believes the Trash appointment is: the press reaches the server and the 409
 * is the authority, so a folder nobody has tried to empty carries no warning.
 * A refusal is a standing fact about the account rather than an event, so it
 * lands under the button and stays there until the user repairs it.
 */
const meta: Meta<typeof EmptyTrashBar> = {
	title: "Flows/Mail/Empty Trash",
	component: EmptyTrashBar,
	parameters: { layout: "fullscreen" },
};
export default meta;

type Story = StoryObj<typeof EmptyTrashBar>;

const noop = () => {};

const TrashList = () => (
	<ul className="divide-y divide-line">
		{[
			["Re: invoice 4421", "Bookkeeping"],
			["Your parcel could not be delivered", "PostNL"],
			["Weekly digest", "Hacker Newsletter"],
		].map(([subject, from]) => (
			<li key={subject} className="px-row-inset py-3">
				<p className="text-sm text-fg">{subject}</p>
				<p className="text-2xs text-fg-subtle">{from}</p>
			</li>
		))}
	</ul>
);

const base = {
	messageCount: 128,
	isEmptying: false,
	trashFolderLabel: "Deleted Items",
	onEmpty: noop,
	onRepair: noop,
	children: <TrashList />,
};

const Frame = ({ children }: { children: React.ReactNode }) => (
	<div className="h-[520px] w-full max-w-2xl overflow-hidden border border-line bg-canvas">
		{children}
	</div>
);

/** The folder holds mail, so the verb is offered — quietly, and to the right. */
export const Idle: Story = {
	render: () => (
		<Frame>
			<EmptyTrashBar {...base} />
		</Frame>
	),
};

/** The press is in flight: the button says so and refuses a second one. */
export const Emptying: Story = {
	render: () => (
		<Frame>
			<EmptyTrashBar {...base} isEmptying />
		</Frame>
	),
};

/**
 * What the run reported, straight from the service. A second press re-marks
 * the same rows and honestly reports the same N — never 0 over an expunge.
 */
export const Emptied: Story = {
	render: () => (
		<Frame>
			<EmptyTrashBar {...base} deletedCount={128} />
		</Frame>
	),
};

/**
 * reader matched the folder by name and nobody confirmed it. The words are
 * `deleteConfirmationCopy`'s, so the dialog and this strip say the same thing.
 */
export const RefusedUnconfirmed: Story = {
	name: "Refused (unconfirmed)",
	render: () => (
		<Frame>
			<EmptyTrashBar {...base} refusalReason="unconfirmed" />
		</Frame>
	),
};

/** The folder the user chose is gone from the mail server, and is named. */
export const RefusedStale: Story = {
	name: "Refused (stale)",
	render: () => (
		<Frame>
			<EmptyTrashBar
				{...base}
				refusalReason="stale"
				staleFolderLabel="Archive/Bin"
			/>
		</Frame>
	),
};

/** Nothing on this account is set as Trash, so there is nothing to empty. */
export const RefusedNone: Story = {
	name: "Refused (none)",
	render: () => (
		<Frame>
			<EmptyTrashBar {...base} refusalReason="none" />
		</Frame>
	),
};
