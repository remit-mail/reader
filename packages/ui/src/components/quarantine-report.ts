import type { FolderRole } from "./folder-role.js";

/**
 * The pipeline step that refused the message.
 *
 * One member, because one member is what the sync path can actually reach
 * today: every `simpleParser` call in `body-sync.ts` parses the whole fetched
 * body in one frame, so a charset, MIME or address defect is not separable
 * from any other mailparser failure at the catch site.
 *
 * Stages are added as Phase 3 narrows those try blocks — never ahead of them.
 * A member no catch site can produce is worse than a missing one: it invites
 * Phase 3 to attribute a failure to it. The obvious candidates cannot fail at
 * all (an unparseable date falls back to INTERNALDATE, an unrecognized MIME
 * type maps to a safe default, addresses arrive pre-parsed in the ENVELOPE),
 * and the attachment path's only failure surface is an S3 write, which must
 * never be quarantined.
 */
export type QuarantineFailureStage = "BodyParse";

/**
 * A node in the message's MIME tree.
 *
 * `contentType` is `type/subtype` only. BODYSTRUCTURE hands the type and its
 * parameters over separately, so a node is built from `type`/`subtype` and
 * never from a raw content-type line — parameters carry `name=` and
 * `filename=`, which name the user's attachments.
 */
export interface QuarantineMimeNode {
	contentType: string;
	parts?: readonly QuarantineMimeNode[];
}

/**
 * A quarantined message as the settings surface sees it.
 *
 * Two fields are stored and shown on screen but never travel in the report:
 * `mailboxPath` (the user's own folder names can be personal) and
 * `failureMessage` (parser errors quote the input that broke them, and
 * redacting arbitrary parser text is not solvable). Everything else is safe to
 * paste into a public issue without reading it first.
 */
export interface QuarantineEntry {
	quarantineId: string;
	accountId: string;
	mailboxId: string;
	/** IMAP uid of the message that was not written. */
	uid: number;
	/** Canonical role of the folder it arrived in — travels in the report. */
	mailboxRole: FolderRole;
	/** The user's own folder name. Shown on screen, withheld from the report. */
	mailboxPath: string;
	failureStage: QuarantineFailureStage;
	/** Closed vocabulary, so it is provably safe to publish. */
	failureCode: string;
	/** Parser error text. Shown on screen, never in the report. */
	failureMessage: string;
	/**
	 * Dot-numbered part path the failure is attributable to, or null when it is
	 * not attributable to one node — the case for a whole-body parse failure.
	 */
	failurePartPath: string | null;
	/** Epoch millis the message was quarantined. */
	quarantinedAt: number;
	/** Rounds attempted before the message was set aside. */
	attempts: number;
	sizeBytes: number;
	/** Top-level Content-Type, `type/subtype` only. */
	contentType: string;
	transferEncoding: string;
	/** Declared charset, or null when the message declared none. */
	charset: string | null;
	/** The MIME tree, structure only. */
	structure: QuarantineMimeNode;
	/** SHA-256 of the Message-ID, `sha256:` prefixed. */
	messageIdHash: string;
	/** Build of the worker that failed to parse — a parse bug belongs to it. */
	appVersion: string;
}

const stageSummaries: Record<QuarantineFailureStage, string> = {
	BodyParse: "The message is built in a way Remit could not read.",
};

/** Plain-language one-liner for a row. The detail lives in the report. */
export function quarantineSummary(stage: QuarantineFailureStage): string {
	return stageSummaries[stage];
}

/**
 * Guards the node contract where the report is rendered, so a node built from
 * a raw content-type line cannot put an attachment filename in the report even
 * if Phase 3 gets the construction wrong.
 */
function stripParameters(contentType: string): string {
	return contentType.split(";")[0].trim();
}

function renderStructure(node: QuarantineMimeNode, depth = 0): string[] {
	const line = `${"  ".repeat(depth)}- ${stripParameters(node.contentType)}`;
	const children = node.parts ?? [];
	return [
		line,
		...children.flatMap((part) => renderStructure(part, depth + 1)),
	];
}

/**
 * The report body, rendered from the record alone so the user can read the
 * whole thing before anything leaves the machine. This is a section a bug
 * report carries — URL budgeting and the repository constant belong to the
 * app's shared bug-report helper, not here.
 */
export function formatQuarantineReport(entry: QuarantineEntry): string {
	return [
		`### Message quarantined at \`${entry.failureStage}\``,
		"",
		`- **Failure**: \`${entry.failureCode}\``,
		`- **Folder role**: ${entry.mailboxRole}`,
		`- **Failing part**: ${entry.failurePartPath === null ? "_whole message_" : `\`${entry.failurePartPath}\``}`,
		`- **Attempts before quarantine**: ${entry.attempts}`,
		`- **Worker build**: ${entry.appVersion}`,
		`- **Message-ID hash**: \`${entry.messageIdHash}\``,
		"",
		"#### Message shape",
		"",
		`- **Content-Type**: \`${stripParameters(entry.contentType)}\``,
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
		"_No message content, addresses, subject, attachment names or parser output are included._",
	].join("\n");
}

/** Issue title. Closed vocabulary only, so it is safe to publish. */
export function quarantineIssueTitle(entry: QuarantineEntry): string {
	return `Message quarantined: ${entry.failureCode} at ${entry.failureStage}`;
}
