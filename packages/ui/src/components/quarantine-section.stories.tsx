import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { QuarantineBugDialog } from "./quarantine-bug-dialog.js";
import type { QuarantineEntry } from "./quarantine-report.js";
import { QuarantineSection } from "./quarantine-section.js";

const REPOSITORY_URL = "https://github.com/remit-mail/reader";

const mimeStructure: QuarantineEntry = {
	quarantineId: "q-1",
	uid: 40217,
	mailboxRole: "inbox",
	mailboxPath: "INBOX",
	failureStage: "MimeStructure",
	failureCode: "UnterminatedMultipartBoundary",
	failureMessage: "multipart boundary was never closed",
	quarantinedAt: Date.parse("2026-07-18T09:12:00Z"),
	attempts: 3,
	sizeBytes: 184_233,
	contentType: "multipart/mixed",
	transferEncoding: "7bit",
	charset: "utf-8",
	structure: {
		contentType: "multipart/mixed",
		parts: [
			{
				contentType: "multipart/alternative",
				parts: [{ contentType: "text/plain" }, { contentType: "text/html" }],
			},
			{ contentType: "application/pdf" },
		],
	},
	headerNames: [
		"Return-Path",
		"Received",
		"Date",
		"From",
		"To",
		"Subject",
		"Message-ID",
		"MIME-Version",
		"Content-Type",
		"X-Mailer",
	],
	messageIdHash: "sha256:6f1c4a…9d20",
	appVersion: "0.14.2",
};

const charsetDecode: QuarantineEntry = {
	quarantineId: "q-2",
	uid: 40219,
	mailboxRole: "archive",
	mailboxPath: "Archive/2026",
	failureStage: "CharsetDecode",
	failureCode: "UnknownCharset",
	failureMessage: "declared charset is not a known encoding",
	quarantinedAt: Date.parse("2026-07-18T14:40:00Z"),
	attempts: 3,
	sizeBytes: 9_812,
	contentType: "text/plain",
	transferEncoding: "quoted-printable",
	charset: "x-user-defined",
	structure: { contentType: "text/plain" },
	headerNames: ["Date", "From", "To", "Subject", "Content-Type"],
	messageIdHash: "sha256:b31e07…44af",
	appVersion: "0.14.2",
};

const dateParse: QuarantineEntry = {
	quarantineId: "q-3",
	uid: 40251,
	mailboxRole: "junk",
	mailboxPath: "Junk",
	failureStage: "DateParse",
	failureCode: "MalformedDateHeader",
	failureMessage: "Date header did not match any known format",
	quarantinedAt: Date.parse("2026-07-19T06:03:00Z"),
	attempts: 1,
	sizeBytes: 2_140,
	contentType: "text/html",
	transferEncoding: "base64",
	charset: null,
	structure: { contentType: "text/html" },
	headerNames: ["Date", "From", "Subject"],
	messageIdHash: "sha256:0a77de…1c05",
	appVersion: "0.14.2",
};

const meta: Meta<typeof QuarantineSection> = {
	title: "Settings/Quarantine",
	component: QuarantineSection,
	parameters: { layout: "padded" },
	args: { onCutBug: () => {}, onRetry: () => {} },
	decorators: [
		(Story) => (
			<div className="mx-auto max-w-2xl">
				<Story />
			</div>
		),
	],
};
export default meta;

type Story = StoryObj<typeof QuarantineSection>;

export const Empty: Story = {
	args: { entries: [] },
};

export const OneEntry: Story = {
	args: { entries: [mimeStructure] },
};

export const AlertState: Story = {
	args: { entries: [mimeStructure, charsetDecode, dateParse] },
};

export const Retrying: Story = {
	args: {
		entries: [mimeStructure, charsetDecode],
		retryingIds: ["q-1"],
	},
};

export const CutABugFlow: Story = {
	render: () => {
		const [open, setOpen] = useState<QuarantineEntry | null>(null);
		const [copied, setCopied] = useState(false);
		return (
			<>
				<QuarantineSection
					entries={[mimeStructure, charsetDecode, dateParse]}
					onCutBug={setOpen}
					onRetry={() => {}}
				/>
				{copied && <p className="mt-3 text-xs text-positive">Report copied.</p>}
				<QuarantineBugDialog
					entry={open}
					repositoryUrl={REPOSITORY_URL}
					onClose={() => setOpen(null)}
					onCopy={() => setCopied(true)}
				/>
			</>
		);
	},
};

export const BugReport: Story = {
	render: () => (
		<QuarantineBugDialog
			entry={mimeStructure}
			repositoryUrl={REPOSITORY_URL}
			onClose={() => {}}
			onCopy={() => {}}
		/>
	),
};
