import type { Meta, StoryObj } from "@storybook/react";
import { useState } from "react";
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

const sitePlan: AttachmentItem = {
	attachmentId: "part-3",
	filename: "site-plan.png",
	typeLabel: "PNG",
	sizeOctets: 486_120,
	download: { status: "idle" },
};

/** How long the app's own fetch takes on a small attachment, near enough. */
const DOWNLOAD_MS = 900;

/**
 * The app owns the fetch and hands per-row state back. The harness plays that
 * part: a press puts the row on the spinner, and the row returns to rest when
 * the file has been handed to the browser. A row is only pressable once at a
 * time, which is the state the component reads to disable it.
 */
const Harness = ({
	attachments,
	hasUnlistedAttachment,
}: {
	attachments: readonly AttachmentItem[];
	hasUnlistedAttachment?: boolean;
}) => {
	const [rows, setRows] = useState<readonly AttachmentItem[]>(attachments);

	const setDownload = (attachmentId: string, item: AttachmentItem) =>
		setRows((current) =>
			current.map((row) => (row.attachmentId === attachmentId ? item : row)),
		);

	const download = (attachmentId: string) => {
		const row = rows.find((item) => item.attachmentId === attachmentId);
		if (!row || row.download.status === "downloading") return;
		setDownload(attachmentId, { ...row, download: { status: "downloading" } });
		setTimeout(
			() => setDownload(attachmentId, { ...row, download: { status: "idle" } }),
			DOWNLOAD_MS,
		);
	};

	return (
		<AttachmentList
			attachments={rows}
			onDownload={download}
			hasUnlistedAttachment={hasUnlistedAttachment}
		/>
	);
};

export const OneAttachment: Story = {
	render: () => <Harness attachments={[report]} />,
};

export const SeveralAttachments: Story = {
	render: () => (
		<Harness
			attachments={[
				report,
				sitePlan,
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
			]}
		/>
	),
};

/** One row mid-fetch. The rows beside it are still pressable. */
export const Downloading: Story = {
	render: () => (
		<Harness
			attachments={[
				{ ...report, download: { status: "downloading" } },
				sitePlan,
			]}
		/>
	),
};

/**
 * A fetch that failed. The row keeps its control, and the alert underneath
 * names what broke and what to do about it — a dead click that leaves the user
 * guessing whether the app, the server or they themselves are at fault is the
 * outcome this list exists to make impossible.
 */
export const DownloadFailed: Story = {
	render: () => (
		<Harness
			attachments={[
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
				sitePlan,
			]}
		/>
	),
};

/**
 * Names written to deceive, as `sanitizeAttachmentFilename` leaves them. The
 * senders wrote `../../../etc/passwd`, `invoice<RLO>gnp.exe` — which renders as
 * `invoiceexe.png` with the override intact — and 400 characters of padding.
 * The list shows exactly the name the file is saved under, so what is read is
 * what lands.
 */
export const HostileFilename: Story = {
	render: () => (
		<Harness
			attachments={[
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
			]}
		/>
	),
};

/**
 * The mail server flagged the message as carrying an attachment, but no body
 * part describes one. Saying nothing here is what made the original paperclip
 * read as broken.
 */
export const UnlistedAttachment: Story = {
	render: () => <Harness attachments={[]} hasUnlistedAttachment />,
};
