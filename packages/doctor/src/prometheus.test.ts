import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseMetrics, seriesNamed } from "./prometheus.js";

describe("parseMetrics", () => {
	it("reads a labelled sample", () => {
		const samples = parseMetrics(
			'# HELP remit_queue_messages Messages.\n# TYPE remit_queue_messages gauge\nremit_queue_messages{queue="imap-sync",role="work"} 3\n',
		);
		assert.deepEqual(samples, [
			{
				name: "remit_queue_messages",
				labels: { queue: "imap-sync", role: "work" },
				value: 3,
			},
		]);
	});

	it("reads a sample with no labels", () => {
		assert.deepEqual(parseMetrics("remit_search_index_backlog_rows 0\n"), [
			{ name: "remit_search_index_backlog_rows", labels: {}, value: 0 },
		]);
	});

	it("drops comments and blank lines without dropping the response", () => {
		const samples = parseMetrics("# HELP x y\n\n  \nx 1\n");
		assert.equal(samples.length, 1);
	});

	it("skips a line it does not recognise rather than refusing the response", () => {
		const samples = parseMetrics("not a sample at all\nx 1\n");
		assert.deepEqual(
			samples.map((sample) => sample.name),
			["x"],
		);
	});

	it("unescapes a quote, a backslash and a newline in a label value", () => {
		const [sample] = parseMetrics(
			'x{a="he said \\"hi\\"",b="c:\\\\path",c="one\\ntwo"} 1\n',
		);
		assert.equal(sample.labels.a, 'he said "hi"');
		assert.equal(sample.labels.b, "c:\\path");
		assert.equal(sample.labels.c, "one\ntwo");
	});

	it("keeps an unknown escape verbatim, both characters", () => {
		const [sample] = parseMetrics('x{a="tab\\there"} 1\n');
		assert.equal(sample.labels.a, "tab\\there");
	});

	it("splits on the comma between pairs, not one inside a value", () => {
		const [sample] = parseMetrics('x{a="one, two",b="three"} 1\n');
		assert.deepEqual(sample.labels, { a: "one, two", b: "three" });
	});

	it("reads a quoted comma at the end of a value", () => {
		const [sample] = parseMetrics('x{a="ends\\",",b="two"} 1\n');
		assert.deepEqual(sample.labels, { a: 'ends",', b: "two" });
	});

	it("reads infinities and NaN", () => {
		const samples = parseMetrics("a +Inf\nb -Inf\nc NaN\n");
		assert.equal(samples[0].value, Number.POSITIVE_INFINITY);
		assert.equal(samples[1].value, Number.NEGATIVE_INFINITY);
		assert.ok(Number.isNaN(samples[2].value));
	});

	it("ignores a trailing timestamp", () => {
		const [sample] = parseMetrics("x 5 1700000000000\n");
		assert.equal(sample.value, 5);
	});

	it("reads an exponent-notation value", () => {
		const [sample] = parseMetrics("x 1.5e+03\n");
		assert.equal(sample.value, 1500);
	});

	it("tolerates an empty label block", () => {
		const [sample] = parseMetrics("x{} 2\n");
		assert.deepEqual(sample.labels, {});
	});

	it("stops on a malformed label block instead of throwing", () => {
		assert.deepEqual(parseMetrics("x{a} 2\n")[0].labels, {});
		assert.deepEqual(parseMetrics('x{a=b"} 2\n')[0].labels, {});
	});
});

describe("seriesNamed", () => {
	const samples = parseMetrics('a{k="1"} 2\na{k="2"} 3\nb 9\nc +Inf\n');

	it("selects one series", () => {
		assert.equal(seriesNamed(samples, "a").length, 2);
	});
});
