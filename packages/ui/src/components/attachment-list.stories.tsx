import type { Meta, StoryObj } from "@storybook/react";
import { type AttachmentItem, AttachmentList } from "./attachment-list.js";

/**
 * The attachment list on an open message (#683). Every row saves a file, so
 * every row is a button; the paperclip in the heading is the only glyph and it
 * is decoration. Nothing here fetches — the app owns the download and hands
 * back per-row state, which is what makes the failure story below the same
 * component the app renders.
 */
const meta: Meta<typeof AttachmentList> = {
	title: "Mail/AttachmentList",
	component: AttachmentList,
	parameters: { layout: "padded" },
};
export default meta;

type Story = StoryObj<typeof AttachmentList>;

const report: AttachmentItem = {
	attachmentId: "part-2",
	filename: "Q3 board pack.pdf",
	typeLabel: "PDF",
	sizeOctets: 2_411_724,
	download: { status: "idle" },
};

export const OneAttachment: Story = {
	args: {
		attachments: [report],
		onDownload: (id) => alert(`Download ${id}`),
	},
};

export const SeveralAttachments: Story = {
	args: {
		attachments: [
			report,
			{
				attachmentId: "part-3",
				filename: "site-plan.png",
				typeLabel: "PNG",
				sizeOctets: 486_120,
				download: { status: "idle" },
			},
			{
				attachmentId: "part-4",
				filename: "notes.txt",
				typeLabel: "PLAIN",
				sizeOctets: 812,
				download: { status: "idle" },
			},
			{
				attachmentId: "part-5",
				filename: "archive",
				typeLabel: "FILE",
				sizeOctets: 1024 ** 3 + 1024 ** 2 * 200,
				download: { status: "idle" },
			},
		],
		onDownload: (id) => alert(`Download ${id}`),
	},
};

export const Downloading: Story = {
	args: {
		attachments: [
			{ ...report, download: { status: "downloading" } },
			{
				attachmentId: "part-3",
				filename: "site-plan.png",
				typeLabel: "PNG",
				sizeOctets: 486_120,
				download: { status: "idle" },
			},
		],
		onDownload: (id) => alert(`Download ${id}`),
	},
};

/**
 * A fetch that failed. The row keeps its control, and the alert underneath
 * names what broke and what to do about it — a dead click that leaves the user
 * guessing whether the app, the server or they themselves are at fault is the
 * outcome this list exists to make impossible.
 */
export const DownloadFailed: Story = {
	args: {
		attachments: [
			{
				...report,
				download: {
					status: "failed",
					title: "This attachment is missing from storage",
					detail:
						"Remit has the message but not the file. Re-sync the account from Settings, then try again.",
					reportUrl: "https://github.com/remit-mail/reader/issues/new",
				},
			},
			{
				attachmentId: "part-3",
				filename: "site-plan.png",
				typeLabel: "PNG",
				sizeOctets: 486_120,
				download: { status: "idle" },
			},
		],
		onDownload: (id) => alert(`Download ${id}`),
	},
};

/**
 * Names written to deceive, as `sanitizeAttachmentFilename` leaves them. The
 * senders wrote `../../../etc/passwd`, `invoice<RLO>gnp.exe` — which renders as
 * `invoiceexe.png` with the override intact — and 400 characters of padding.
 * The list shows exactly the name the file is saved under, so what is read is
 * what lands.
 */
export const HostileFilename: Story = {
	args: {
		attachments: [
			{
				attachmentId: "part-6",
				filename: "passwd",
				typeLabel: "FILE",
				sizeOctets: 3_120,
				download: { status: "idle" },
			},
			{
				attachmentId: "part-7",
				filename: "invoicegnp.exe",
				typeLabel: "FILE",
				sizeOctets: 118_400,
				download: { status: "idle" },
			},
			{
				attachmentId: "part-8",
				filename: `${"long-name-".repeat(11)}report.pdf`,
				typeLabel: "PDF",
				sizeOctets: 44_000,
				download: { status: "idle" },
			},
		],
		onDownload: (id) => alert(`Download ${id}`),
	},
};

/**
 * The mail server flagged the message as carrying an attachment, but no body
 * part describes one. Saying nothing here is what made the original paperclip
 * read as broken.
 */
export const UnlistedAttachment: Story = {
	args: {
		attachments: [],
		onDownload: () => undefined,
		hasUnlistedAttachment: true,
	},
};
