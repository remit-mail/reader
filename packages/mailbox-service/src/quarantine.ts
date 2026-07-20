import type {
	IMailboxSpecialUseRepository,
	IQuarantineRepository,
	MessageData,
	MessageItem,
	QuarantineItem,
	QuarantineMimeNodeItem,
} from "@remit/data-ports";
import { quarantineMessageIdHash, ROOT_PART_PATH } from "@remit/data-ports/id";
import { CanonicalMailboxRole } from "@remit/domain-enums";
import type { ImapBodyStructure, ImapMessage } from "./types.js";

type CanonicalRole = NonNullable<QuarantineItem["mailboxRole"]>;
type FailureStage = QuarantineItem["failureStage"];
type FailureCode = QuarantineItem["failureCode"];

const CANONICAL_ROLES = new Set<string>(Object.values(CanonicalMailboxRole));

/**
 * The canonical role of the folder a quarantined message arrived in, read from
 * the server's own RFC 6154 SPECIAL-USE declaration — the same source the
 * appointment flow seeds from. A folder the server declares nothing about has
 * no role, which is the normal state for a plain folder and is why the field
 * is optional. `Important` is a SPECIAL-USE with no canonical role and drops
 * out here rather than being invented into one.
 */
export const resolveMailboxRole = (
	mailboxPath: string,
	specialUse: readonly string[],
): CanonicalRole | undefined => {
	if (mailboxPath.toUpperCase() === "INBOX") return CanonicalMailboxRole.Inbox;
	const matched = specialUse.find((use) => CANONICAL_ROLES.has(use));
	return matched as CanonicalRole | undefined;
};

/** Everything about the quarantine that is the same for every uid in a round. */
export interface QuarantineContext {
	accountId: string;
	accountConfigId: string;
	mailboxId: string;
	mailboxPath: string;
	uidValidity: number;
	/** Rounds tried before the message was set aside. */
	attempts: number;
}

/**
 * The repro fingerprint: what the message declared itself to be. Every field
 * is optional-by-absence because a message can fail before its shape was read,
 * and a required column would force the writer to invent a value or drop the
 * record.
 */
export interface QuarantineMessageShape {
	contentType?: string;
	transferEncoding?: string;
	charset?: string;
	sizeBytes?: number;
	structure: QuarantineMimeNodeItem[];
	messageIdHash?: string;
}

export interface QuarantineFailure {
	stage: FailureStage;
	code: FailureCode;
	/** Parser error text. Stored, shown on screen, never published. */
	message: string;
	partPath?: string;
}

const EMPTY_SHAPE: QuarantineMessageShape = { structure: [] };

const walkBodyStructure = (
	node: ImapBodyStructure,
	depth: number,
	into: QuarantineMimeNodeItem[],
): void => {
	into.push({ depth, contentType: node.type });
	for (const child of node.childNodes ?? []) {
		walkBodyStructure(child, depth + 1, into);
	}
};

/**
 * Message shape off a FETCH result. Every field here came pre-parsed over the
 * wire in the same FETCH, so it survives exactly when local parsing is what
 * failed. Nodes are built from the BODYSTRUCTURE type, never from a raw
 * content-type line — a raw line carries `name=` and `filename=`, which name
 * the user's own attachments.
 */
export const shapeFromImapMessage = (
	msg: ImapMessage,
): QuarantineMessageShape => {
	const root = msg.bodyStructure;
	if (!root) {
		return {
			...(msg.size > 0 ? { sizeBytes: msg.size } : {}),
			structure: [],
			...hashOf(msg.envelope?.messageId),
		};
	}

	const structure: QuarantineMimeNodeItem[] = [];
	walkBodyStructure(root, 0, structure);

	return {
		contentType: root.type,
		...(root.encoding ? { transferEncoding: root.encoding } : {}),
		...(root.parameters?.charset ? { charset: root.parameters.charset } : {}),
		...(msg.size > 0 ? { sizeBytes: msg.size } : {}),
		structure,
		...hashOf(msg.envelope?.messageId),
	};
};

/**
 * Message shape off the rows metadata sync already wrote. The body path has no
 * FETCH result to read — it streams raw bytes — but the MIME tree it needs was
 * walked into BodyPart rows when the message's metadata was synced, so the
 * fingerprint comes from there rather than from re-reading headers the parser
 * has just refused.
 */
export const shapeFromMessageData = (
	message: MessageItem,
	data: MessageData,
): QuarantineMessageShape => {
	const parts = [...data.bodyPart].sort((a, b) =>
		a.partPath.localeCompare(b.partPath, "en", { numeric: true }),
	);
	const root = parts.find((part) => part.partPath === ROOT_PART_PATH);
	const rootCharset = root
		? data.bodyPartParameter.find(
				(param) =>
					param.bodyPartId === root.bodyPartId &&
					param.parameterName.toLowerCase() === "charset",
			)?.parameterValue
		: undefined;

	return {
		...(root ? { contentType: `${root.mediaType}/${root.mediaSubtype}` } : {}),
		...(root ? { transferEncoding: root.transferEncoding } : {}),
		...(rootCharset ? { charset: rootCharset } : {}),
		...(message.rfc822Size ? { sizeBytes: message.rfc822Size } : {}),
		structure: parts.map((part) => ({
			depth: partPathDepth(part.partPath),
			contentType: `${part.mediaType}/${part.mediaSubtype}`,
		})),
		...hashOf(message.messageIdHeader),
	};
};

const partPathDepth = (partPath: string): number =>
	partPath === ROOT_PART_PATH ? 0 : partPath.split(".").length;

const hashOf = (
	messageIdHeader: string | undefined,
): { messageIdHash?: string } => {
	const messageIdHash = quarantineMessageIdHash(messageIdHeader);
	return messageIdHash ? { messageIdHash } : {};
};

/**
 * The set of messages already set aside, held for the duration of one sync
 * round. A round loads it once and filters against it in memory: the list is
 * small by design — a growing one is a bug being reported, not a page to
 * paginate — and a lookup per message would put a query on the hot path for a
 * state that is almost always empty.
 */
export class QuarantinedUids {
	private readonly keys: ReadonlySet<string>;

	constructor(entries: readonly QuarantineItem[]) {
		this.keys = new Set(
			entries.map((entry) =>
				uidKey(entry.mailboxId, entry.uidValidity, entry.uid),
			),
		);
	}

	get size(): number {
		return this.keys.size;
	}

	has(mailboxId: string, uidValidity: number, uid: number): boolean {
		return this.keys.has(uidKey(mailboxId, uidValidity, uid));
	}
}

const uidKey = (mailboxId: string, uidValidity: number, uid: number): string =>
	`${mailboxId}:${uidValidity}:${uid}`;

export interface QuarantineLogger {
	info(obj: Record<string, unknown>, msg: string): void;
	warn(obj: Record<string, unknown>, msg: string): void;
}

/**
 * Writes the record a message becomes when the sync path cannot apply it
 * (issue #72), and loads the set a round filters against.
 *
 * Only a message defect reaches this class. Deciding that is the caller's job
 * and it is made at exactly one kind of catch site — one narrow enough that
 * the error can only have come from the message itself. An S3, queue or
 * database failure propagates; writing one here would advance a cursor past
 * mail that is fine and tell the user it was unreadable.
 */
export class QuarantineService {
	constructor(
		private readonly repository: IQuarantineRepository,
		private readonly mailboxSpecialUseService: IMailboxSpecialUseRepository,
		private readonly workerVersion: string,
		private readonly log: QuarantineLogger,
	) {}

	async load(accountConfigId: string): Promise<QuarantinedUids> {
		return new QuarantinedUids(
			await this.repository.listByAccountConfigId(accountConfigId),
		);
	}

	/**
	 * Set a message aside. Resolves only once the row is durable, because the
	 * caller's next act is to let a cursor move past this uid — and a cursor
	 * that moves past work no record survives is the silent loss this whole
	 * feature exists to end.
	 */
	async record(
		context: QuarantineContext,
		uid: number,
		failure: QuarantineFailure,
		shape: QuarantineMessageShape = EMPTY_SHAPE,
	): Promise<void> {
		// Resolved here rather than per round: a round almost never writes a row,
		// so the lookup belongs on the write and not on the hot path.
		const specialUse = await this.mailboxSpecialUseService.listByMailboxId(
			context.mailboxId,
		);
		const mailboxRole = resolveMailboxRole(
			context.mailboxPath,
			specialUse.map((entry) => entry.specialUse),
		);

		await this.repository.upsert({
			accountConfigId: context.accountConfigId,
			accountId: context.accountId,
			mailboxId: context.mailboxId,
			uidValidity: context.uidValidity,
			uid,
			...(mailboxRole ? { mailboxRole } : {}),
			mailboxPath: context.mailboxPath,
			quarantinedAt: Date.now(),
			attempts: context.attempts,
			failureStage: failure.stage,
			failureCode: failure.code,
			failureMessage: failure.message,
			...(failure.partPath ? { failurePartPath: failure.partPath } : {}),
			workerVersion: this.workerVersion,
			...shape,
		});

		this.log.warn(
			{
				mailboxId: context.mailboxId,
				mailboxPath: context.mailboxPath,
				uid,
				uidValidity: context.uidValidity,
				failureStage: failure.stage,
				failureCode: failure.code,
			},
			"Message quarantined; cursor may advance past it",
		);
	}
}
