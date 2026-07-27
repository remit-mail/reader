import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	exitCodeFor,
	renderJson,
	renderLines,
	writeVerdict,
} from "./report.js";
import type { CheckResult } from "./verdict.js";

const degraded: CheckResult = {
	verdict: "degraded",
	checkedAt: "2026-07-27T10:00:00.000Z",
	summary: "remit is degraded",
	reasons: [
		{
			code: "account_sync_stalled",
			summary: "1 of 3 accounts have not completed a sync in over 3h",
			detail: "0f8a: 40000s",
		},
		{
			code: "dead_letter_queue_not_empty",
			summary:
				"2 messages are quarantined on 1 dead-letter queue (imap-sync-dlq)",
			detail: undefined,
		},
	],
	counters: {},
};

const healthy: CheckResult = {
	verdict: "healthy",
	checkedAt: "2026-07-27T10:00:00.000Z",
	summary: "remit is healthy",
	reasons: [],
	counters: {},
};

/** The parse the wrapper does: first token is the key, the rest is the value. */
const parseLines = (out: string): [string, string][] =>
	out
		.split("\n")
		.filter((line) => line !== "")
		.map((line) => {
			const space = line.indexOf(" ");
			return [line.slice(0, space), line.slice(space + 1)] as [string, string];
		});

describe("the line format", () => {
	it("opens with the verdict, the timestamp and the headline", () => {
		const records = parseLines(renderLines(degraded));
		assert.deepEqual(records.slice(0, 3), [
			["verdict", "degraded"],
			["checked-at", "2026-07-27T10:00:00.000Z"],
			["summary", "remit is degraded"],
		]);
	});

	it("carries one record per reason, then the details", () => {
		const records = parseLines(renderLines(degraded));
		assert.deepEqual(
			records.filter(([key]) => key === "reason").map(([, value]) => value),
			[
				"account_sync_stalled 1 of 3 accounts have not completed a sync in over 3h",
				"dead_letter_queue_not_empty 2 messages are quarantined on 1 dead-letter queue (imap-sync-dlq)",
			],
		);
		assert.deepEqual(
			records.filter(([key]) => key === "detail").map(([, value]) => value),
			["account_sync_stalled 0f8a: 40000s"],
		);
	});

	it("uses a closed key vocabulary, so an unknown key is a version skew and not a value", () => {
		const keys = new Set(parseLines(renderLines(degraded)).map(([key]) => key));
		assert.deepEqual([...keys].sort(), [
			"checked-at",
			"detail",
			"reason",
			"summary",
			"verdict",
		]);
	});

	it("puts no reason records in a healthy report", () => {
		const records = parseLines(renderLines(healthy));
		assert.equal(records.length, 3);
	});

	it("never wraps a record, so one line is always one record", () => {
		for (const line of renderLines(degraded).trimEnd().split("\n")) {
			assert.ok(line.length > 0);
			assert.ok(!line.includes("\n"));
		}
	});

	// A queue name can hold a newline: the exposition format escapes it and the
	// parser decodes it back. Split across two lines, a caller reading by
	// position takes the remainder as a record with a garbage key and silently
	// drops half the reason. The JSON body escapes its way out of this; a line
	// format cannot.
	it("keeps a newline in a value from splitting the record", () => {
		const nasty: CheckResult = {
			...degraded,
			reasons: [
				{
					code: "dead_letter_queue_not_empty",
					summary:
						'2 messages are quarantined on 1 dead-letter queue (bad\nname"x)',
					detail: "first\r\nsecond",
				},
			],
		};
		const out = renderLines(nasty);
		assert.equal(out.trimEnd().split("\n").length, 5);
		const records = parseLines(out);
		assert.deepEqual(
			records.filter(([key]) => key === "reason").map(([, value]) => value),
			[
				'dead_letter_queue_not_empty 2 messages are quarantined on 1 dead-letter queue (bad name"x)',
			],
		);
		assert.deepEqual(
			records.filter(([key]) => key === "detail").map(([, value]) => value),
			["dead_letter_queue_not_empty first second"],
		);
	});

	it("collapses every C0 control character, not only the newline", () => {
		const out = renderLines({
			...degraded,
			reasons: [
				{
					code: "scrape_failed",
					summary: "a\u0000b\u001bc\u007fd",
					detail: undefined,
				},
			],
		});
		assert.equal(out.trimEnd().split("\n").length, 4);
		assert.match(out, /reason scrape_failed a b c d/);
	});
});

describe("the json format", () => {
	it("parses, and carries the same verdict and reasons", () => {
		const parsed = JSON.parse(renderJson(degraded)) as {
			verdict: string;
			reasons: { code: string; summary: string; detail: string | null }[];
		};
		assert.equal(parsed.verdict, "degraded");
		assert.deepEqual(
			parsed.reasons.map((reason) => reason.code),
			["account_sync_stalled", "dead_letter_queue_not_empty"],
		);
		assert.equal(parsed.reasons[1].detail, null);
	});

	it("renders a healthy verdict as an empty reason list, not an absent key", () => {
		const parsed = JSON.parse(renderJson(healthy)) as { reasons: unknown[] };
		assert.deepEqual(parsed.reasons, []);
	});
});

describe("exit codes", () => {
	it("is zero on healthy and non-zero on degraded, so cron can use it directly", () => {
		assert.equal(exitCodeFor(healthy), 0);
		assert.equal(exitCodeFor(degraded), 1);
	});
});

describe("writeVerdict", () => {
	// The whole point: `process.exit` discards a write the kernel could not
	// take, so the verdict has to be out of the process before the code is
	// returned. A stream that reports back-pressure and drains later is what a
	// pipe under `compose exec -T` does with a long degraded verdict.
	const backPressured = () => {
		const chunks: string[] = [];
		let drain: (() => void) | undefined;
		return {
			chunks,
			release: () => drain?.(),
			stream: {
				write(text: string) {
					chunks.push(text);
					return false;
				},
				once(event: string, listener: () => void) {
					if (event === "drain") drain = listener;
					return this;
				},
			} as unknown as NodeJS.WritableStream,
		};
	};

	it("does not resolve until the stream drains", async () => {
		const sink = backPressured();
		let settled = false;
		const done = writeVerdict(sink.stream, renderLines(degraded)).then(() => {
			settled = true;
		});
		await new Promise((resolve) => setImmediate(resolve));
		assert.equal(settled, false, "resolved before the stream drained");
		sink.release();
		await done;
		assert.equal(sink.chunks.join(""), renderLines(degraded));
	});

	it("resolves straight away when the write was taken", async () => {
		const chunks: string[] = [];
		const stream = {
			write(text: string) {
				chunks.push(text);
				return true;
			},
			once() {
				assert.fail("waited on drain after a write that was taken");
			},
		} as unknown as NodeJS.WritableStream;
		await writeVerdict(stream, renderJson(healthy));
		assert.equal(chunks.join(""), renderJson(healthy));
	});
});
