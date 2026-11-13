import type { MailboxItem } from "@remit/data-ports";

export const REMIT_ROOT_ALPHABET = "abcdefghijklmnopqrstuvwxyz234567";
export const REMIT_ROOT_SUFFIX = "_remit";

const BASE = REMIT_ROOT_ALPHABET.length;
const RANDOM_LENGTH = 4;
const PREFIX_LENGTH = RANDOM_LENGTH + 1;

export type RemitRootCandidate = Pick<
	MailboxItem,
	"mailboxId" | "accountId" | "fullPath" | "hierarchyDelimiter" | "syncStatus"
>;

export interface RemitRootLogger {
	warn(obj: Record<string, unknown>, msg: string): void;
}

const luhnSum = (codePoints: readonly number[], firstFactor: 1 | 2): number =>
	codePoints.reduceRight((sum, codePoint, index) => {
		const fromRight = codePoints.length - 1 - index;
		const factor = fromRight % 2 === 0 ? firstFactor : 3 - firstFactor;
		const product = codePoint * factor;
		return sum + Math.floor(product / BASE) + (product % BASE);
	}, 0);

const codePointsOf = (text: string): number[] | undefined => {
	const codePoints = [...text].map((char) => REMIT_ROOT_ALPHABET.indexOf(char));
	return codePoints.every((codePoint) => codePoint >= 0)
		? codePoints
		: undefined;
};

export const remitRootName = (randomPart: string): string => {
	const codePoints = codePointsOf(randomPart);
	if (codePoints === undefined || codePoints.length !== RANDOM_LENGTH) {
		throw new Error(
			`A remit root random part is ${RANDOM_LENGTH} characters of ${REMIT_ROOT_ALPHABET}, got "${randomPart}"`,
		);
	}
	const check = (BASE - (luhnSum(codePoints, 2) % BASE)) % BASE;
	return `${randomPart}${REMIT_ROOT_ALPHABET[check]}${REMIT_ROOT_SUFFIX}`;
};

export const generateRemitRootName = (): string => {
	const bytes = crypto.getRandomValues(new Uint8Array(RANDOM_LENGTH));
	return remitRootName(
		[...bytes].map((byte) => REMIT_ROOT_ALPHABET[byte % BASE]).join(""),
	);
};

export const isRemitRootName = (name: string): boolean => {
	if (name.length !== PREFIX_LENGTH + REMIT_ROOT_SUFFIX.length) return false;
	if (!name.endsWith(REMIT_ROOT_SUFFIX)) return false;
	const codePoints = codePointsOf(name.slice(0, PREFIX_LENGTH));
	if (codePoints === undefined) return false;
	return luhnSum(codePoints, 1) % BASE === 0;
};

const inboxChildName = (mailbox: RemitRootCandidate): string | undefined => {
	const delimiter = mailbox.hierarchyDelimiter;
	if (delimiter === "") return undefined;
	const head = `INBOX${delimiter}`;
	if (mailbox.fullPath.slice(0, head.length).toUpperCase() !== head) {
		return undefined;
	}
	const name = mailbox.fullPath.slice(head.length);
	if (name === "" || name.includes(delimiter)) return undefined;
	return name;
};

const compareBytes = (left: string, right: string): number => {
	const encoder = new TextEncoder();
	const a = encoder.encode(left);
	const b = encoder.encode(right);
	const length = Math.min(a.length, b.length);
	for (let index = 0; index < length; index++) {
		const difference = (a[index] ?? 0) - (b[index] ?? 0);
		if (difference !== 0) return difference;
	}
	return a.length - b.length;
};

export const discoverRemitRoot = <T extends RemitRootCandidate>(
	mailboxes: readonly T[],
	log: RemitRootLogger,
): T | undefined => {
	const candidates = mailboxes
		.filter((mailbox) => {
			const name = inboxChildName(mailbox);
			return name !== undefined && isRemitRootName(name);
		})
		.sort((left, right) => compareBytes(left.fullPath, right.fullPath));
	const [root] = candidates;
	if (root === undefined) return undefined;
	if (candidates.length > 1) {
		log.warn(
			{
				accountId: root.accountId,
				mailboxId: root.mailboxId,
				fullPath: root.fullPath,
				candidates: candidates.map((mailbox) => ({
					mailboxId: mailbox.mailboxId,
					fullPath: mailbox.fullPath,
					syncStatus: mailbox.syncStatus,
				})),
			},
			"More than one remit root folder; took the first in byte order",
		);
	}
	return root;
};
