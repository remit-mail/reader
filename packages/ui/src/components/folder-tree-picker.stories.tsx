import type { Meta, StoryObj } from "@storybook/react";
import { type ReactNode, useState } from "react";
import type { StepId } from "../lib/wizard-steps.js";
import { type FolderTreeNode, FolderTreePicker } from "./folder-tree-picker.js";
import { FooterNav, WizardScreen } from "./selection-wizard.js";

const folders: FolderTreeNode[] = [
	{ id: "mbx-inbox", label: "Inbox", path: "INBOX", isCurrent: true },
	{ id: "mbx-archive", label: "Archive", path: "Archive" },
	{ id: "mbx-sent", label: "Sent", path: "Sent Items" },
	{ id: "mbx-spam", label: "Spam", path: "Junk" },
	{ id: "mbx-trash", label: "Trash", path: "Deleted Messages" },
	{ id: "mbx-travel", label: "Travel", path: "Travel" },
	{ id: "mbx-travel-flights", label: "Flights", path: "Travel/Flights" },
	{ id: "mbx-travel-hotels", label: "Hotels", path: "Travel/Hotels" },
	{
		id: "mbx-travel-hotels-receipts",
		label: "Receipts",
		path: "Travel/Hotels/Receipts",
	},
	{ id: "mbx-travel-trains", label: "Trains", path: "Travel/Trains" },
	{ id: "mbx-finance", label: "Finance", path: "Finance" },
	{ id: "mbx-finance-invoices", label: "Invoices", path: "Finance/Invoices" },
	{
		id: "mbx-finance-invoices-2025",
		label: "2025",
		path: "Finance/Invoices/2025",
	},
	{
		id: "mbx-finance-invoices-2026",
		label: "2026",
		path: "Finance/Invoices/2026",
	},
	{ id: "mbx-finance-tax", label: "Tax", path: "Finance/Tax" },
	{ id: "mbx-family", label: "Family", path: "Family" },
	{ id: "mbx-news", label: "Newsletters", path: "Newsletters" },
	{ id: "mbx-news-tech", label: "Tech", path: "Newsletters/Tech" },
	{ id: "mbx-news-design", label: "Design", path: "Newsletters/Design" },
	{ id: "mbx-work", label: "Work", path: "Work" },
	{ id: "mbx-work-projects", label: "Projects", path: "Work/Projects" },
	{ id: "mbx-work-apollo", label: "Apollo", path: "Work/Projects/Apollo" },
	{
		id: "mbx-work-borealis",
		label: "Borealis",
		path: "Work/Projects/Borealis",
	},
	{ id: "mbx-work-recruiting", label: "Recruiting", path: "Work/Recruiting" },
];

const longFolders: FolderTreeNode[] = [
	...folders,
	...Array.from({ length: 36 }, (_, i) => ({
		id: `mbx-client-${i}`,
		label: `Client ${String(i + 1).padStart(2, "0")}`,
		path: `Work/Projects/Client ${String(i + 1).padStart(2, "0")}`,
	})),
];

const meta: Meta<typeof FolderTreePicker> = {
	title: "Mail/FolderTreePicker",
	component: FolderTreePicker,
	parameters: { layout: "centered" },
};
export default meta;

type Story = StoryObj<typeof FolderTreePicker>;

function Frame({ children }: { children: ReactNode }) {
	return (
		<div className="flex h-[560px] w-[360px] flex-col overflow-hidden rounded-lg border border-line bg-surface font-sans text-fg shadow-lg">
			{children}
		</div>
	);
}

let createdSeq = 0;
const createFolder = (
	name: string,
	parentPath: string,
): Promise<FolderTreeNode> =>
	new Promise((resolve) => {
		createdSeq += 1;
		setTimeout(
			() =>
				resolve({
					id: `mbx-created-${createdSeq}`,
					label: name,
					path: parentPath ? `${parentPath}/${name}` : name,
				}),
			400,
		);
	});

const neverResolves = (): Promise<FolderTreeNode> =>
	new Promise<FolderTreeNode>(() => undefined);

const rejects = (message: string) => (): Promise<FolderTreeNode> =>
	Promise.reject(new Error(message));

function Picker({
	options = folders,
	onCreateFolder = createFolder,
}: {
	options?: FolderTreeNode[];
	onCreateFolder?: (
		name: string,
		parentPath: string,
		signal?: AbortSignal,
	) => Promise<FolderTreeNode>;
}) {
	const [selected, setSelected] = useState<string>();
	const [known, setKnown] = useState(options);
	return (
		<Frame>
			<FolderTreePicker
				folders={known}
				selectedId={selected}
				onSelect={setSelected}
				onCreateFolder={(name, parentPath, signal) =>
					onCreateFolder(name, parentPath, signal).then((created) => {
						setKnown((current) => [...current, created]);
						return created;
					})
				}
			/>
		</Frame>
	);
}

/** The list at rest: top level only, one tap deep into anything. */
export const Default: Story = {
	name: "Default (collapsed to top level)",
	render: () => <Picker />,
};

export const WithoutCreate: Story = {
	name: "No create affordance",
	render: () => {
		const ReadOnly = () => {
			const [selected, setSelected] = useState<string>();
			return (
				<Frame>
					<FolderTreePicker
						folders={folders}
						selectedId={selected}
						onSelect={setSelected}
					/>
				</Frame>
			);
		};
		return <ReadOnly />;
	},
};

export const LongList: Story = {
	name: "Long list (scrolls)",
	render: () => <Picker options={longFolders} />,
};

export const Empty: Story = {
	name: "No folders",
	render: () => <Picker options={[]} />,
};

const setInputValue = (input: HTMLInputElement, value: string) => {
	const setter = Object.getOwnPropertyDescriptor(
		HTMLInputElement.prototype,
		"value",
	)?.set;
	setter?.call(input, value);
	input.dispatchEvent(new Event("input", { bubbles: true }));
};

const typeFilter = (canvasElement: HTMLElement, value: string) => {
	const input = canvasElement.querySelector<HTMLInputElement>(
		'input[type="search"]',
	);
	if (input) setInputValue(input, value);
};

const clickAriaLabel = (canvasElement: HTMLElement, label: string) => {
	canvasElement
		.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)
		?.click();
};

const clickText = (canvasElement: HTMLElement, label: string) => {
	Array.from(canvasElement.querySelectorAll<HTMLButtonElement>("button"))
		.find((button) => button.textContent?.trim() === label)
		?.click();
};

const typeFolderName = (canvasElement: HTMLElement, name: string) => {
	const input = canvasElement.querySelector<HTMLInputElement>(
		'input:not([type="search"])',
	);
	if (input) setInputValue(input, name);
};

const tick = () => new Promise((resolve) => setTimeout(resolve, 60));

const expand = async (canvasElement: HTMLElement, ...labels: string[]) => {
	for (const label of labels) {
		clickAriaLabel(canvasElement, `Move to ${label}`);
		await tick();
	}
};

/**
 * One tap picks the destination and opens it. The children arrive indented,
 * with "New folder" sitting at the end of them as the last folder inside.
 */
export const Expanded: Story = {
	name: "A folder opened (children and its New folder)",
	render: () => <Picker />,
	play: async ({ canvasElement }) => {
		await expand(canvasElement, "Travel");
	},
};

/** Three levels open at once, each with its own place to add a folder. */
export const DeepExpansion: Story = {
	name: "Opened three levels deep",
	render: () => <Picker />,
	play: async ({ canvasElement }) => {
		await expand(canvasElement, "Travel", "Hotels", "Receipts");
	},
};

/**
 * "rec" matches two nested folders. Their parents open to put them on screen
 * and read as the branches they are, not as an answer to what was typed.
 */
export const Filtered: Story = {
	name: "Filtered (ancestors opened for context)",
	render: () => <Picker />,
	play: async ({ canvasElement }) => {
		typeFilter(canvasElement, "rec");
	},
};

export const CreateTopLevel: Story = {
	name: "Create a top-level folder",
	render: () => <Picker />,
	play: async ({ canvasElement }) => {
		clickAriaLabel(canvasElement, "New folder");
		await tick();
		typeFolderName(canvasElement, "Insurance");
	},
};

/**
 * The folder you opened is the answer to "inside where": the action sits among
 * its children and the form states the parent as text, so there is no second
 * choice to make.
 */
export const CreateSubfolder: Story = {
	name: "Create a folder inside an opened one",
	render: () => <Picker />,
	play: async ({ canvasElement }) => {
		await expand(canvasElement, "Travel");
		clickAriaLabel(canvasElement, "New folder inside Travel");
		await tick();
		typeFolderName(canvasElement, "Car hire");
	},
};

/**
 * Creating a folder is an IMAP mutation: the form holds until the mail server
 * confirms the folder, and refuses a second submit while it waits.
 */
export const CreatePending: Story = {
	name: "Create — waiting for the server",
	render: () => <Picker onCreateFolder={neverResolves} />,
	play: async ({ canvasElement }) => {
		await expand(canvasElement, "Finance");
		clickAriaLabel(canvasElement, "New folder inside Finance");
		await tick();
		typeFolderName(canvasElement, "Mortgage");
		await tick();
		clickText(canvasElement, "Create folder");
	},
};

/** The failure is stated where it happened; the form stays open to retry. */
export const CreateFailed: Story = {
	name: "Create — failed (retry in place)",
	render: () => (
		<Picker
			onCreateFolder={rejects(
				"The mail server refused the folder name. Try another one.",
			)}
		/>
	),
	play: async ({ canvasElement }) => {
		await expand(canvasElement, "Finance");
		clickAriaLabel(canvasElement, "New folder inside Finance");
		await tick();
		typeFolderName(canvasElement, "Mortgage");
		await tick();
		clickText(canvasElement, "Create folder");
	},
};

const wizardSteps: StepId[] = ["match", "folder", "rule", "review"];

function WizardFolderStep() {
	const [selected, setSelected] = useState<string>();
	const [known, setKnown] = useState(folders);
	const chosen = known.find((folder) => folder.id === selected);
	return (
		<WizardScreen
			title="Move to"
			subtitle="Pick a destination"
			steps={wizardSteps}
			step="folder"
			onBack={() => undefined}
			onExit={() => undefined}
			footer={
				<FooterNav
					onBack={() => undefined}
					nextLabel="Continue"
					onNext={() => undefined}
					blockedReason={chosen ? undefined : "Pick a folder to move into."}
				/>
			}
		>
			<div className="flex min-h-0 flex-col gap-3">
				<p className="px-1 text-xs text-fg-muted">
					{chosen
						? `Moving to ${chosen.label}.`
						: "Tap a folder to open it, or make a new one where you want it."}
				</p>
				<div className="flex min-h-0 flex-1 overflow-hidden rounded-lg border border-line bg-surface">
					<FolderTreePicker
						folders={known}
						selectedId={selected}
						onSelect={setSelected}
						onCreateFolder={(name, parentPath) =>
							createFolder(name, parentPath).then((created) => {
								setKnown((current) => [...current, created]);
								return created;
							})
						}
						labels={{
							createPending:
								"Waiting for the mail server to confirm the folder…",
						}}
					/>
				</div>
			</div>
		</WizardScreen>
	);
}

/** The pattern at the size it is used: the wizard's folder step on a phone. */
export const PhoneWizardStep: Story = {
	name: "Phone — wizard folder step",
	parameters: { layout: "fullscreen" },
	globals: { viewport: { value: "mobile" } },
	render: () => <WizardFolderStep />,
};
