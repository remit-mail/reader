import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	advanceMove,
	beginMove,
	excludeFolder,
	type FolderNode,
	failMove,
	guardFolderDeletion,
	hasChildFolders,
	initialStage,
	moveProgressLabel,
	vouchedRole,
} from "./delete-folder.js";

const folder = (
	over: Partial<FolderNode> & { mailboxId: string },
): FolderNode => ({
	fullPath: over.mailboxId,
	hierarchyDelimiter: "/",
	messageCount: 0,
	...over,
});

describe("guardFolderDeletion", () => {
	it("blocks the inbox by its reserved path, case-insensitively", () => {
		const target = folder({ mailboxId: "a", fullPath: "InBoX" });
		const guard = guardFolderDeletion(target, [target], []);
		assert.equal(guard.deletable, false);
		assert.equal(guard.reason, "inbox");
		assert.match(guard.message ?? "", /inbox can't be deleted/i);
	});

	it("blocks a folder appointed to a canonical role and names the role", () => {
		const target = folder({ mailboxId: "arch", fullPath: "Archive" });
		const guard = guardFolderDeletion(
			target,
			[target],
			[{ role: "Archive", source: "Appointed", mailboxId: "arch" }],
		);
		assert.equal(guard.deletable, false);
		assert.equal(guard.reason, "role");
		assert.match(guard.message ?? "", /Archive/);
	});

	it("blocks a folder the mail server flagged for the role", () => {
		const target = folder({ mailboxId: "sent", fullPath: "Sent" });
		const guard = guardFolderDeletion(
			target,
			[target],
			[{ role: "Sent", source: "Flagged", mailboxId: "sent" }],
		);
		assert.equal(guard.deletable, false);
		assert.equal(guard.reason, "role");
	});

	it("deletes a folder whose only role claim is a name proposal", () => {
		const target = folder({ mailboxId: "arch", fullPath: "Archive" });
		const guard = guardFolderDeletion(
			target,
			[target],
			[{ role: "Archive", source: "Proposed", mailboxId: "arch" }],
		);
		assert.deepEqual(guard, { deletable: true });
	});

	it("deletes the fallback a stale appointment resolves to", () => {
		const target = folder({ mailboxId: "deleted-items", fullPath: "Deleted" });
		const guard = guardFolderDeletion(
			target,
			[target],
			[{ role: "Trash", source: "Stale", mailboxId: "deleted-items" }],
		);
		assert.deepEqual(guard, { deletable: true });
	});

	it("blocks a folder that has subfolders", () => {
		const target = folder({ mailboxId: "work", fullPath: "Work" });
		const child = folder({ mailboxId: "sub", fullPath: "Work/Shop" });
		const guard = guardFolderDeletion(target, [target, child], []);
		assert.equal(guard.deletable, false);
		assert.equal(guard.reason, "children");
		assert.match(guard.message ?? "", /subfolders/i);
	});

	it("allows a plain leaf folder with no role and no children", () => {
		const target = folder({
			mailboxId: "r",
			fullPath: "Receipts",
			messageCount: 4,
		});
		const other = folder({ mailboxId: "n", fullPath: "News" });
		const guard = guardFolderDeletion(
			target,
			[target, other],
			[{ role: "Archive", source: "Appointed", mailboxId: "other-box" }],
		);
		assert.deepEqual(guard, { deletable: true });
	});

	it("ignores an unfilled role appointment with no mailbox", () => {
		const target = folder({ mailboxId: "r", fullPath: "Receipts" });
		const guard = guardFolderDeletion(
			target,
			[target],
			[{ role: "Junk", source: "None" }],
		);
		assert.equal(guard.deletable, true);
	});
});

describe("hasChildFolders", () => {
	it("treats a delimiter-separated nested path as a child", () => {
		const parent = {
			mailboxId: "p",
			fullPath: "Work",
			hierarchyDelimiter: "/",
		};
		const kids = [{ mailboxId: "c", fullPath: "Work/Q3" }];
		assert.equal(hasChildFolders(parent, [...kids, parent]), true);
	});

	it("does not treat a shared string prefix without a delimiter as a child", () => {
		const parent = {
			mailboxId: "p",
			fullPath: "Work",
			hierarchyDelimiter: "/",
		};
		const lookalike = [{ mailboxId: "w", fullPath: "Workshop" }];
		assert.equal(hasChildFolders(parent, [...lookalike, parent]), false);
	});

	it("honours a non-slash delimiter", () => {
		const parent = {
			mailboxId: "p",
			fullPath: "INBOX",
			hierarchyDelimiter: ".",
		};
		const kids = [{ mailboxId: "c", fullPath: "INBOX.Sub" }];
		assert.equal(hasChildFolders(parent, [...kids, parent]), true);
	});
});

describe("vouchedRole", () => {
	it("returns the role a mailbox fills", () => {
		assert.equal(
			vouchedRole("a", [
				{ role: "Trash", source: "Appointed", mailboxId: "a" },
			]),
			"Trash",
		);
	});

	it("returns undefined when the mailbox fills no role", () => {
		assert.equal(
			vouchedRole("a", [
				{ role: "Trash", source: "Appointed", mailboxId: "b" },
			]),
			undefined,
		);
	});

	it("returns undefined for a role nobody vouched for", () => {
		assert.equal(
			vouchedRole("a", [{ role: "Trash", source: "Proposed", mailboxId: "a" }]),
			undefined,
		);
	});
});

describe("excludeFolder", () => {
	it("drops the folder being deleted from the destination list", () => {
		const targets = [
			{ mailboxId: "a" },
			{ mailboxId: "b" },
			{ mailboxId: "c" },
		];
		assert.deepEqual(excludeFolder(targets, "b"), [
			{ mailboxId: "a" },
			{ mailboxId: "c" },
		]);
	});
});

describe("move progress", () => {
	it("begins at zero and moving for a non-empty set", () => {
		assert.deepEqual(beginMove(120), { total: 120, moved: 0, phase: "moving" });
	});

	it("begins already moved for an empty set", () => {
		assert.deepEqual(beginMove(0), { total: 0, moved: 0, phase: "moved" });
	});

	it("advances by the batch size and finishes at the total", () => {
		let progress = beginMove(150);
		progress = advanceMove(progress, 100);
		assert.deepEqual(progress, { total: 150, moved: 100, phase: "moving" });
		progress = advanceMove(progress, 50);
		assert.deepEqual(progress, { total: 150, moved: 150, phase: "moved" });
	});

	it("clamps moved to the total if the folder shrank underneath the count", () => {
		const progress = advanceMove(beginMove(80), 100);
		assert.equal(progress.moved, 80);
		assert.equal(progress.phase, "moved");
	});

	it("stops progress on failure and does not advance afterwards", () => {
		const failed = failMove(beginMove(150), "boom");
		assert.equal(failed.phase, "failed");
		assert.equal(failed.moved, 0);
		const after = advanceMove(failed, 100);
		assert.deepEqual(after, failed);
	});

	it("labels progress as moved-of-total", () => {
		assert.equal(
			moveProgressLabel({ total: 150, moved: 100, phase: "moving" }),
			"Moved 100 of 150",
		);
	});
});

describe("initialStage", () => {
	it("opens on the empty confirm for a folder with no mail", () => {
		assert.equal(initialStage(0), "confirm-empty");
	});

	it("opens on the fate choice for a folder holding mail", () => {
		assert.equal(initialStage(3), "choose-fate");
	});
});
