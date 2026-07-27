/**
 * The subset of the Prometheus text exposition format this checker reads back.
 *
 * Hand-written rather than a dependency: the checker is the container that has
 * to keep working when the rest of the stack does not, and the whole grammar it
 * needs is a name, an optional label set and a float. prom-client renders the
 * format and does not parse it, so a parser is either sixty lines here or a
 * third-party package in the one image whose job is to outlive failures.
 */
export interface Sample {
	readonly name: string;
	readonly labels: Readonly<Record<string, string>>;
	readonly value: number;
}

const UNESCAPE: Readonly<Record<string, string>> = {
	n: "\n",
	'"': '"',
	"\\": "\\",
};

/**
 * Label values escape `\`, `"` and a newline, and nothing else — a `\t` in the
 * wire format is a literal backslash followed by `t`, so an unknown escape
 * keeps both characters rather than swallowing the backslash.
 */
const unescapeLabelValue = (raw: string): string => {
	let out = "";
	for (let index = 0; index < raw.length; index += 1) {
		const char = raw[index];
		if (char !== "\\" || index === raw.length - 1) {
			out += char;
			continue;
		}
		const next = raw[index + 1];
		const decoded = UNESCAPE[next];
		out += decoded ?? `\\${next}`;
		index += 1;
	}
	return out;
};

/**
 * Split a label block on the commas that separate pairs, ignoring any comma
 * inside a quoted value. Written as a scan rather than a regular expression
 * because a value may contain `",` verbatim once unescaped.
 */
const parseLabels = (block: string): Record<string, string> => {
	const labels: Record<string, string> = {};
	let index = 0;
	while (index < block.length) {
		const equals = block.indexOf("=", index);
		if (equals === -1) break;
		const name = block.slice(index, equals).trim();
		const openQuote = block.indexOf('"', equals);
		if (openQuote === -1) break;
		let cursor = openQuote + 1;
		let raw = "";
		while (cursor < block.length) {
			const char = block[cursor];
			if (char === "\\") {
				raw += block.slice(cursor, cursor + 2);
				cursor += 2;
				continue;
			}
			if (char === '"') break;
			raw += char;
			cursor += 1;
		}
		// Only when the value was actually closed. A truncated block is garbage,
		// and recording a label whose value is "whatever was left" invents a
		// series the exporter never rendered.
		if (name !== "" && block[cursor] === '"') {
			labels[name] = unescapeLabelValue(raw);
		}
		const comma = block.indexOf(",", cursor);
		if (comma === -1) break;
		index = comma + 1;
	}
	return labels;
};

/**
 * The value, or `undefined` when the token is not one. `NaN` is a legitimate
 * sample value and parses; a word that merely happens to sit where a value goes
 * does not, so a line of prose cannot become a series.
 */
const parseValue = (raw: string): number | undefined => {
	const token = raw.trim().split(/\s+/)[0] ?? "";
	if (token === "+Inf") return Number.POSITIVE_INFINITY;
	if (token === "-Inf") return Number.NEGATIVE_INFINITY;
	if (token === "NaN") return Number.NaN;
	const parsed = Number(token);
	return token === "" || Number.isNaN(parsed) ? undefined : parsed;
};

const SERIES = /^([A-Za-z_:][A-Za-z0-9_:]*)(\{(.*)\})?[ \t]+(.+)$/;

/**
 * Every sample in an exposition response, in the order it was rendered.
 * `# HELP`/`# TYPE` lines and blanks are dropped; a line that is not a sample
 * is skipped rather than throwing, because a scraper that refuses a whole
 * response over one unfamiliar line reports a healthy service as unreachable.
 */
export const parseMetrics = (body: string): Sample[] => {
	const samples: Sample[] = [];
	for (const line of body.split("\n")) {
		const trimmed = line.trim();
		if (trimmed === "" || trimmed.startsWith("#")) continue;
		const match = SERIES.exec(trimmed);
		if (!match) continue;
		const [, name, , labelBlock, raw] = match;
		const value = parseValue(raw);
		if (value === undefined) continue;
		samples.push({
			name,
			labels: labelBlock === undefined ? {} : parseLabels(labelBlock),
			value,
		});
	}
	return samples;
};

/** Every sample of one series, across every scraped target. */
export const seriesNamed = (
	samples: readonly Sample[],
	name: string,
): Sample[] => samples.filter((sample) => sample.name === name);

/** The sum of one series, `0` when nothing exported it. */
export const sumOf = (samples: readonly Sample[], name: string): number =>
	seriesNamed(samples, name).reduce(
		(total, sample) =>
			total + (Number.isFinite(sample.value) ? sample.value : 0),
		0,
	);
