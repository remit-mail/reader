import type { FolderRole } from "./folder-role.js";

/**
 * The pipeline step that refused the message.
 *
 * One member, because **no catch site on the sync path can currently tell a
 * parse failure from an infrastructure failure**. The per-message frame in
 * `body-sync.ts` wraps the S3 body write, the parsed-body cache write, the
 * body-part `pMap` and DynamoDB upsert, the placement move (SQS + DynamoDB)
 * and the label and counter writes, alongside the `simpleParser` call; only
 * connection drops are filtered out of it.
 *
 * **Precondition on Phase 3**: narrow the try block to the parse call before
 * quarantining anything. Quarantining at the frame as it stands would set a
 * message aside for a DynamoDB throttle, tell the user it was unreadable, and
 * invite a public GitHub issue for an outage — the same defect as naming an
 * S3 write `AttachmentExtract`, one layer up.
 *
 * There are three distinct parse sites, and a quarantine would have to
 * attribute them differently: the fresh-fetch path, `backfillClassification`
 * (its own parse over a different result list), and the header parse in
 * `imapflow-connection.ts`, which is swallowed and treated as "no thread
 * parent". Stages are added as those sites are separated — never ahead of it.
 *
 * The stages this replaced could not fire at all: an unparseable Date falls
 * back to INTERNALDATE, and an unrecognized MIME type maps to a safe default
 * rather than throwing. Unparseable addresses are dropped with a `continue`
 * and the message is written anyway — so that defect is reached but discarded,
 * never raised, which is a reason to have no `AddressParse` stage but not the
 * reason that it cannot happen.
 */
export type QuarantineFailureStage = "BodyParse";

/**
 * The specific defect within a stage.
 *
 * Closed, because `quarantineIssueTitle` interpolates it into a public issue
 * title: a `string` here would make the one field whose publishability is
 * asserted rather than derived into free text. Grows with the narrowing
 * described on `QuarantineFailureStage`, and no faster.
 */
export type QuarantineFailureCode =
	| "UnterminatedMultipartBoundary"
	| "UnknownCharset"
	| "TruncatedBody";

/**
 * One node of the message's MIME tree, in a pre-order walk.
 *
 * The tree arrives flat with an explicit `depth` rather than as nested
 * children: a self-referential model is not expressible in the schema this
 * comes from, and the tree is only ever rendered as an indented list, which a
 * pre-order walk reproduces exactly.
 *
 * `contentType` is `type/subtype` only. BODYSTRUCTURE hands the type and its
 * parameters over separately, so a node is built from `type`/`subtype` and
 * never from a raw content-type line — parameters carry `name=` and
 * `filename=`, which name the user's attachments.
 */
export interface QuarantineMimeNode {
	depth: number;
	contentType: string;
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
	/**
	 * Canonical role of the folder it arrived in — travels in the report. Null
	 * when the user appointed no role to that folder, which is the ordinary
	 * state of a plain folder.
	 */
	mailboxRole: FolderRole | null;
	/** The user's own folder name. Shown on screen, withheld from the report. */
	mailboxPath: string;
	failureStage: QuarantineFailureStage;
	failureCode: QuarantineFailureCode;
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
	/** The MIME tree, structure only, as a pre-order walk. */
	structure: readonly QuarantineMimeNode[];
	/** SHA-256 of the Message-ID, `sha256:` prefixed. */
	messageIdHash: string;
	/** Build of the worker that failed to parse — a parse bug belongs to it. */
	workerVersion: string;
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

/** RFC 2045 token characters — what a charset or encoding is allowed to be. */
const TOKEN = /^[A-Za-z0-9!#$%&'*+._-]+$/;
const MEDIA_TYPE = /^[A-Za-z0-9!#$%&'*+._-]+\/[A-Za-z0-9!#$%&'*+._-]+$/;

/**
 * `charset`, `transferEncoding` and `contentType` are BODYSTRUCTURE strings —
 * arbitrary quoted text chosen by whoever sent the message, echoed into an
 * issue filed under the user's own account. A conforming value renders as
 * itself; anything else is JSON-escaped, so newlines and backticks cannot
 * close the code span and inject markdown. The malformed value is kept rather
 * than dropped, because a malformed value is usually the bug.
 */
function renderToken(value: string, pattern: RegExp): string {
	if (pattern.test(value)) return `\`${value}\``;
	const escaped = JSON.stringify(value).replace(/`/g, "\\u0060");
	return `\`${escaped}\` (malformed)`;
}

/** Inside a fence the only escape is a lone fence line, so tokens are enough. */
function renderNodeType(contentType: string): string {
	const stripped = stripParameters(contentType);
	if (MEDIA_TYPE.test(stripped)) return stripped;
	return JSON.stringify(stripped);
}

function renderStructure(nodes: readonly QuarantineMimeNode[]): string[] {
	return nodes.map(
		(node) => `${"  ".repeat(node.depth)}- ${renderNodeType(node.contentType)}`,
	);
}

export const QUARANTINE_REPORT_DISCLAIMER =
	"_No message content, addresses, subject, attachment names or parser output are included._";

/**
 * The report split into the parts a bug report assembles.
 *
 * `structure` is the only unbounded section, so it is handed over unfenced:
 * the URL budget truncates it and fences it afterwards, the same shape a
 * stacktrace already uses. Fencing here instead would let the binary search
 * cut inside the fence, leaving every following section rendered inside one
 * code block — and the first line lost would be the disclaimer, so the one
 * report that is truncated would be the one with no statement of what was
 * withheld.
 */
export interface QuarantineReportSections {
	head: string;
	structure: string;
	disclaimer: string;
}

export function quarantineReportSections(
	entry: QuarantineEntry,
): QuarantineReportSections {
	const head = [
		`### Message quarantined at \`${entry.failureStage}\``,
		"",
		`- **Failure**: \`${entry.failureCode}\``,
		`- **Folder role**: ${entry.mailboxRole ?? "_none appointed_"}`,
		`- **Failing part**: ${entry.failurePartPath === null ? "_whole message_" : `\`${entry.failurePartPath}\``}`,
		`- **Attempts before quarantine**: ${entry.attempts}`,
		`- **Worker build**: ${entry.workerVersion}`,
		`- **Message-ID hash**: \`${entry.messageIdHash}\``,
		"",
		"#### Message shape",
		"",
		`- **Content-Type**: ${renderToken(stripParameters(entry.contentType), MEDIA_TYPE)}`,
		`- **Content-Transfer-Encoding**: ${renderToken(entry.transferEncoding, TOKEN)}`,
		`- **Charset**: ${entry.charset === null ? "_not declared_" : renderToken(entry.charset, TOKEN)}`,
		`- **Size**: ${entry.sizeBytes} bytes`,
		"",
		"MIME structure:",
	].join("\n");

	return {
		head,
		structure: renderStructure(entry.structure).join("\n"),
		disclaimer: QUARANTINE_REPORT_DISCLAIMER,
	};
}

/**
 * The whole report as one string — what the dialog shows and the copy action
 * copies. The published issue is assembled from the sections instead, so that
 * a long MIME tree can be truncated without breaking the fence.
 */
export function formatQuarantineReport(entry: QuarantineEntry): string {
	const { head, structure, disclaimer } = quarantineReportSections(entry);
	return [head, "", "```", structure, "```", "", disclaimer].join("\n");
}

/** Issue title. Closed vocabulary only, so it is safe to publish. */
export function quarantineIssueTitle(entry: QuarantineEntry): string {
	return `Message quarantined: ${entry.failureCode} at ${entry.failureStage}`;
}
