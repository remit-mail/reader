import type { FolderRole } from "./folder-role.js";

/**
 * The pipeline step that refused the message. This is the bucket a bug lands
 * in, so it is an enum rather than free text — two reports naming the same
 * stage are the same class of defect.
 */
export type QuarantineFailureStage =
	| "HeaderParse"
	| "MimeStructure"
	| "AddressParse"
	| "DateParse"
	| "CharsetDecode"
	| "AttachmentExtract";

/** A node in the message's MIME tree. Content types only, never content. */
export interface QuarantineMimeNode {
	contentType: string;
	parts?: readonly QuarantineMimeNode[];
}

/**
 * A quarantined message as the settings surface sees it.
 *
 * Every field here is safe to paste into a public issue except `mailboxPath`,
 * which is the user's own folder name and stays on-screen only — the report
 * carries `mailboxRole` instead. Nothing on this record reveals who wrote the
 * message, what it said, or what was attached to it.
 */
export interface QuarantineEntry {
	quarantineId: string;
	/** IMAP uid of the message that was not written. */
	uid: number;
	/** Canonical role of the folder it arrived in — travels in the report. */
	mailboxRole: FolderRole;
	/** The user's own folder name. Shown on screen, withheld from the report. */
	mailboxPath: string;
	failureStage: QuarantineFailureStage;
	/** Stable machine code for the specific defect within the stage. */
	failureCode: string;
	/** Parser error text, redacted of any message content before storage. */
	failureMessage: string;
	/** Epoch millis the message was quarantined. */
	quarantinedAt: number;
	/** Rounds attempted before the message was set aside. */
	attempts: number;
	sizeBytes: number;
	/** Top-level Content-Type, parameters stripped. */
	contentType: string;
	transferEncoding: string;
	/** Declared charset, or null when the message declared none. */
	charset: string | null;
	/** The MIME tree, structure only. */
	structure: QuarantineMimeNode;
	/** Names of the headers present, in order. Values are never stored. */
	headerNames: readonly string[];
	/** Hash of the Message-ID, so two reports about one message correlate. */
	messageIdHash: string;
	/** Build that produced the failure — a fix is meaningless without it. */
	appVersion: string;
}

const stageSummaries: Record<QuarantineFailureStage, string> = {
	HeaderParse: "The message headers could not be read.",
	MimeStructure: "The message is built in a way Remit could not take apart.",
	AddressParse: "A sender or recipient address could not be read.",
	DateParse: "The message date could not be read.",
	CharsetDecode: "The message text is in an encoding Remit could not decode.",
	AttachmentExtract: "An attachment could not be separated from the message.",
};

/** Plain-language one-liner for a row. The detail lives in the report. */
export function quarantineSummary(stage: QuarantineFailureStage): string {
	return stageSummaries[stage];
}

function renderStructure(node: QuarantineMimeNode, depth = 0): string[] {
	const line = `${"  ".repeat(depth)}- ${node.contentType}`;
	const children = node.parts ?? [];
	return [
		line,
		...children.flatMap((part) => renderStructure(part, depth + 1)),
	];
}

/**
 * The exact text filed as a bug. Rendered from the record alone so the user
 * can read the whole thing before anything leaves the machine.
 */
export function formatQuarantineReport(entry: QuarantineEntry): string {
	return [
		`### Message quarantined at \`${entry.failureStage}\``,
		"",
		`- **Failure**: \`${entry.failureCode}\` — ${entry.failureMessage}`,
		`- **Folder role**: ${entry.mailboxRole}`,
		`- **Attempts before quarantine**: ${entry.attempts}`,
		`- **Remit version**: ${entry.appVersion}`,
		`- **Message-ID hash**: \`${entry.messageIdHash}\``,
		"",
		"#### Message shape",
		"",
		`- **Content-Type**: \`${entry.contentType}\``,
		`- **Content-Transfer-Encoding**: \`${entry.transferEncoding}\``,
		`- **Charset**: ${entry.charset === null ? "_not declared_" : `\`${entry.charset}\``}`,
		`- **Size**: ${entry.sizeBytes} bytes`,
		"",
		"MIME structure:",
		"",
		"```",
		...renderStructure(entry.structure),
		"```",
		"",
		"Headers present:",
		"",
		"```",
		entry.headerNames.join(", "),
		"```",
		"",
		"_No message content, addresses, subject or attachment names are included._",
	].join("\n");
}

/** Prefilled issue URL. Filing happens in the user's own GitHub session. */
export function quarantineIssueUrl(
	entry: QuarantineEntry,
	repositoryUrl: string,
): string {
	const title = `Message quarantined: ${entry.failureCode} at ${entry.failureStage}`;
	const params = new URLSearchParams({
		title,
		body: formatQuarantineReport(entry),
		labels: "quarantine",
	});
	return `${repositoryUrl}/issues/new?${params.toString()}`;
}
