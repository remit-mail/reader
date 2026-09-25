import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	type AttachmentTransport,
	ComposeAttachmentController,
	type MintedAttachment,
} from "./compose-attachment-controller";

const DRAFT = "draft-1";

interface Deferred<T> {
	promise: Promise<T>;
	resolve: (value: T) => void;
	reject: (error: unknown) => void;
}

const deferred = <T>(): Deferred<T> => {
	let resolve: (value: T) => void = () => {};
	let reject: (error: unknown) => void = () => {};
	const promise = new Promise<T>((res, rej) => {
		resolve = res;
		reject = rej;
	});
	return { promise, resolve, reject };
};

const settle = () => new Promise((resolve) => setImmediate(resolve));

/**
 * A server that answers each request only when the test says so, and remembers
 * what the draft holds the way `retainOnly` does: a keep list drops every
 * reservation it does not name.
 */
const createServer = () => {
	const mints = new Map<string, Deferred<MintedAttachment>>();
	const onDraft = new Set<string>();
	const put: string[] = [];
	const completed: string[] = [];
	const keeps: string[][] = [];
	let keepFailure: Error | null = null;

	const transport: AttachmentTransport = {
		mint: (_draft, file) => {
			const answer = deferred<MintedAttachment>();
			mints.set(file.name, answer);
			return answer.promise.then((minted) => {
				onDraft.add(minted.outboxAttachmentId);
				return minted;
			});
		},
		put: async (uploadUrl, _file, signal) => {
			if (signal.aborted) throw new Error("aborted");
			put.push(uploadUrl);
		},
		complete: async (_draft, outboxAttachmentId) => {
			completed.push(outboxAttachmentId);
		},
		keep: async (_draft, attachmentIds) => {
			keeps.push(attachmentIds);
			if (keepFailure) throw keepFailure;
			for (const id of [...onDraft]) {
				if (!attachmentIds.includes(id)) onDraft.delete(id);
			}
		},
	};

	const answerMint = (filename: string, outboxAttachmentId: string) => {
		const answer = mints.get(filename);
		if (!answer) throw new Error(`no reservation asked for ${filename}`);
		answer.resolve({
			outboxAttachmentId,
			filename,
			uploadUrl: `https://upload.test/${outboxAttachmentId}`,
		});
	};

	return {
		transport,
		answerMint,
		onDraft,
		put,
		completed,
		keeps,
		failKeeps: (error: Error | null) => {
			keepFailure = error;
		},
	};
};

const file = (name: string) => new File(["bytes"], name);

const setup = () => {
	const server = createServer();
	const controller = new ComposeAttachmentController({
		transport: () => server.transport,
		ensureDraft: async () => ({ outcome: "ready", outboxMessageId: DRAFT }),
	});
	return { server, controller };
};

const rowFor = (controller: ComposeAttachmentController, filename: string) =>
	controller.getSnapshot().find((item) => item.filename === filename);

describe("ComposeAttachmentController", () => {
	it("attaches a file through reserve, upload and confirm", async () => {
		const { server, controller } = setup();

		const attaching = controller.attach([file("report.pdf")]);
		await settle();
		server.answerMint("report.pdf", "att-1");
		await attaching;

		assert.deepEqual(rowFor(controller, "report.pdf")?.state, {
			status: "attached",
		});
		assert.deepEqual(server.put, ["https://upload.test/att-1"]);
		assert.deepEqual(server.completed, ["att-1"]);
		assert.equal(controller.blockingReason(), undefined);
	});

	it("takes a file removed while its reservation is out off the draft, and never uploads it", async () => {
		const { server, controller } = setup();

		const attaching = controller.attach([file("payroll.xlsx")]);
		await settle();
		const removing = controller.remove(controller.getSnapshot()[0].key);
		assert.equal(controller.getSnapshot().length, 0, "the row goes at once");

		server.answerMint("payroll.xlsx", "att-payroll");
		await Promise.all([attaching, removing]);

		assert.deepEqual(server.put, [], "nothing was uploaded");
		assert.deepEqual(server.completed, [], "nothing was confirmed");
		assert.deepEqual(server.keeps, [[]], "the draft was told it keeps nothing");
		assert.equal(server.onDraft.has("att-payroll"), false);
		assert.equal(controller.blockingReason(), undefined);
	});

	it("keeps a file whose reservation is still out when another one is removed", async () => {
		const { server, controller } = setup();

		const first = controller.attach([file("first.pdf")]);
		await settle();
		server.answerMint("first.pdf", "att-first");
		await first;

		const second = controller.attach([file("second.pdf")]);
		await settle();
		const removing = controller.remove(
			rowFor(controller, "first.pdf")?.key ?? "",
		);
		await settle();
		assert.deepEqual(
			server.keeps,
			[],
			"the keep list waits for the reservation",
		);

		server.answerMint("second.pdf", "att-second");
		await Promise.all([second, removing]);

		assert.deepEqual(server.keeps, [["att-second"]]);
		assert.equal(server.onDraft.has("att-second"), true);
		assert.equal(server.onDraft.has("att-first"), false);
		assert.deepEqual(rowFor(controller, "second.pdf")?.state, {
			status: "attached",
		});
	});

	it("puts a file back, marked, when the server would not remove it", async () => {
		const { server, controller } = setup();

		const attaching = controller.attach([file("contract.pdf")]);
		await settle();
		server.answerMint("contract.pdf", "att-contract");
		await attaching;

		server.failKeeps(new Error("the server answered 500"));
		await controller.remove(controller.getSnapshot()[0].key);

		const row = rowFor(controller, "contract.pdf");
		assert.equal(row?.state.status, "failed");
		assert.match(
			row?.state.status === "failed" ? row.state.reason : "",
			/"contract\.pdf" could not be removed: the server answered 500\. It is still on the draft/,
		);
		assert.match(
			controller.blockingReason() ?? "",
			/"contract\.pdf" is not attached/,
		);

		server.failKeeps(null);
		await controller.remove(controller.getSnapshot()[0].key);
		assert.deepEqual(server.keeps.at(-1), []);
		assert.equal(controller.getSnapshot().length, 0);
	});

	it("blocks sending while a file uploads, naming it", async () => {
		const { server, controller } = setup();

		const attaching = controller.attach([file("minutes.docx")]);
		await settle();
		assert.equal(
			controller.blockingReason(),
			'"minutes.docx" is still uploading.',
		);

		server.answerMint("minutes.docx", "att-minutes");
		await attaching;
		assert.equal(controller.blockingReason(), undefined);
	});
});
