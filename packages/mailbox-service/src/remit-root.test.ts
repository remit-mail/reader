import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { MailboxSyncStatus } from "@remit/domain-enums";
import {
	discoverRemitRoot,
	generateRemitRootName,
	isRemitRootName,
	REMIT_ROOT_ALPHABET,
	type RemitRootCandidate,
	remitRootName,
} from "./remit-root.js";

const everyRandomPart = function* (): Generator<string> {
	for (const a of REMIT_ROOT_ALPHABET)
		for (const b of REMIT_ROOT_ALPHABET)
			for (const c of REMIT_ROOT_ALPHABET)
				for (const d of REMIT_ROOT_ALPHABET) yield `${a}${b}${c}${d}`;
};

describe("remit root name", () => {
	it("validates every name the scheme can build", () => {
		for (const randomPart of everyRandomPart()) {
			const name = remitRootName(randomPart);
			assert.ok(isRemitRootName(name), name);
		}
	});

	it("validates generated names", () => {
		for (let round = 0; round < 1000; round++) {
			assert.ok(isRemitRootName(generateRemitRootName()));
		}
	});

	it("rejects a name with any one prefix character changed", () => {
		for (const randomPart of ["aaaa", "abcd", "z7q2", "7777", "m3xk"]) {
			const name = remitRootName(randomPart);
			for (let position = 0; position < 5; position++) {
				for (const replacement of REMIT_ROOT_ALPHABET) {
					if (replacement === name[position]) continue;
					const changed = `${name.slice(0, position)}${replacement}${name.slice(position + 1)}`;
					assert.equal(isRemitRootName(changed), false, changed);
				}
			}
		}
	});

	it("rejects a prefix of the wrong length", () => {
		const name = remitRootName("abcd");
		assert.equal(isRemitRootName(name.slice(1)), false);
		assert.equal(isRemitRootName(`a${name}`), false);
		assert.equal(isRemitRootName("_remit"), false);
	});

	it("rejects characters outside the alphabet and a wrong suffix", () => {
		const name = remitRootName("abcd");
		assert.equal(isRemitRootName(name.toUpperCase()), false);
		assert.equal(isRemitRootName(`${name.slice(0, 5)}_Remit`), false);
		assert.equal(isRemitRootName(`${name.slice(0, 5)}-remit`), false);
		assert.equal(isRemitRootName("abc0a_remit"), false);
	});
});

const mailbox = (
	fullPath: string,
	syncStatus: RemitRootCandidate["syncStatus"] = MailboxSyncStatus.synced,
): RemitRootCandidate => ({
	mailboxId: `id-${fullPath}`,
	accountId: "account-1",
	fullPath,
	hierarchyDelimiter: "/",
	syncStatus,
});

const capturingLog = () => {
	const lines: Array<{ obj: Record<string, unknown>; msg: string }> = [];
	return {
		lines,
		warn: (obj: Record<string, unknown>, msg: string) => {
			lines.push({ obj, msg });
		},
	};
};

describe("discoverRemitRoot", () => {
	const first = remitRootName("aaaa");
	const second = remitRootName("bbbb");

	it("finds none when no child of INBOX validates", () => {
		const log = capturingLog();
		const root = discoverRemitRoot(
			[
				mailbox("INBOX"),
				mailbox("INBOX/Receipts"),
				mailbox(`INBOX/Receipts/${first}`),
				mailbox(first),
				mailbox(`Archive/${first}`),
				mailbox(`INBOX/${first.toUpperCase()}`),
			],
			log,
		);
		assert.equal(root, undefined);
		assert.equal(log.lines.length, 0);
	});

	it("finds the one root", () => {
		const log = capturingLog();
		const root = discoverRemitRoot(
			[mailbox("INBOX"), mailbox(`INBOX/${second}`), mailbox("Sent")],
			log,
		);
		assert.equal(root?.fullPath, `INBOX/${second}`);
		assert.equal(log.lines.length, 0);
	});

	it("takes the first in byte order of two and logs one line", () => {
		const log = capturingLog();
		const root = discoverRemitRoot(
			[mailbox(`INBOX/${second}`), mailbox(`INBOX/${first}`)],
			log,
		);
		assert.equal(root?.fullPath, `INBOX/${first}`);
		assert.equal(log.lines.length, 1);
		assert.equal(log.lines[0]?.obj.fullPath, `INBOX/${first}`);
	});

	it("counts a pending create as the root", () => {
		const log = capturingLog();
		const root = discoverRemitRoot(
			[mailbox("INBOX"), mailbox(`INBOX/${first}`, MailboxSyncStatus.pending)],
			log,
		);
		assert.equal(root?.syncStatus, MailboxSyncStatus.pending);
	});
});
