/**
 * Hunspell, over the WebAssembly build in `docker/hunspell/`. The engine
 * and the two dictionary files are fetched, never bundled: a language costs
 * nothing until someone writes in it, and the bytes are reported as they arrive
 * because the first Dutch download is fourteen seconds on a bad link and a
 * composer that says nothing for fourteen seconds looks broken.
 *
 * Dictionaries are handed to Hunspell as paths, so the two files go into the
 * module's own in-memory filesystem exactly as downloaded. Nothing rewrites
 * them — the served bytes are the upstream source, which is what keeps every
 * dictionary licence at its verbatim-redistribution minimum.
 */

export interface SpellEngine {
	spell(word: string): boolean;
	suggest(word: string): readonly string[];
	add(word: string): void;
	close(): void;
}

export interface DownloadProgress {
	readonly bytesLoaded: number;
	readonly bytesTotal: number;
}

export interface EngineFailure {
	readonly ok: false;
	/** Never arrived, or arrived and was rejected — different remedies. */
	readonly reason: "download" | "engine";
	readonly detail: string;
}

/**
 * Opening is two designed failures and a success, so it answers with which one
 * rather than throwing: what the composer puts in front of the writer, and what
 * the report link carries, is this string.
 */
export type EngineResult =
	| { readonly ok: true; readonly engine: SpellEngine }
	| EngineFailure;

type Attempt<T> = { readonly ok: true; readonly value: T } | EngineFailure;

interface HunspellModule {
	readonly FS: { writeFile(path: string, data: Uint8Array): void };
	_free(pointer: number): void;
	_remit_open(affPath: number, dicPath: number): number;
	_remit_close(handle: number): void;
	_remit_spell(handle: number, word: number): number;
	_remit_add(handle: number, word: number): number;
	_remit_suggest(handle: number, word: number): number;
	stringToNewUTF8(text: string): number;
	UTF8ToString(pointer: number): string;
}

interface HunspellOptions {
	instantiateWasm(
		imports: WebAssembly.Imports,
		ready: (instance: WebAssembly.Instance, module: WebAssembly.Module) => void,
	): Record<string, never>;
}

type HunspellFactory = (options: HunspellOptions) => Promise<HunspellModule>;

const isFactory = (value: unknown): value is { default: HunspellFactory } =>
	typeof value === "object" &&
	value !== null &&
	typeof (value as { default?: unknown }).default === "function";

export interface EngineAssets {
	/** The Emscripten loader, as an ES module with the factory as its default. */
	loadFactory(url: string): Promise<unknown>;
	fetch(url: string): Promise<Response>;
}

const browserAssets: EngineAssets = {
	loadFactory: (url) => import(/* @vite-ignore */ url),
	fetch: (url) => fetch(url),
};

const failure = (
	reason: "download" | "engine",
	detail: string,
): EngineFailure => ({ ok: false, reason, detail });

const said = (error: unknown): string =>
	error instanceof Error ? error.message : String(error);

const attempt = <T>(
	work: Promise<T>,
	reason: "download" | "engine",
	describe: (message: string) => string,
): Promise<Attempt<T>> =>
	work.then(
		(value) => ({ ok: true as const, value }),
		(error: unknown) => failure(reason, describe(said(error))),
	);

/**
 * A failure a person can act on: the file, the status, and nothing about
 * promises.
 */
const download = async (
	assets: EngineAssets,
	url: string,
): Promise<Attempt<Response>> => {
	const fetched = await attempt(
		assets.fetch(url),
		"download",
		(message) => `${url} could not be reached: ${message}`,
	);
	if (!fetched.ok) return fetched;
	if (!fetched.value.ok) {
		return failure("download", `${url} answered ${fetched.value.status}`);
	}
	return fetched;
};

const readBody = async (
	response: Response,
	counted: (added: number) => void,
): Promise<Uint8Array<ArrayBuffer>> => {
	const body = response.body;
	if (!body) {
		const whole = new Uint8Array(await response.arrayBuffer());
		counted(whole.byteLength);
		return whole;
	}
	const reader = body.getReader();
	const chunks: Uint8Array[] = [];
	let size = 0;
	for (;;) {
		const step = await reader.read();
		if (step.done) break;
		chunks.push(step.value);
		size += step.value.byteLength;
		counted(step.value.byteLength);
	}
	const whole = new Uint8Array(size);
	let at = 0;
	for (const chunk of chunks) {
		whole.set(chunk, at);
		at += chunk.byteLength;
	}
	return whole;
};

export interface EngineRequest {
	/** Where `hunspell.mjs`, `hunspell.wasm` and `dictionaries/` are served. */
	readonly base: string;
	/** The tag the build staged, which is not always the tag the writer picked. */
	readonly tag: string;
	/**
	 * What the build says these files weigh. `content-length` is the wrong
	 * number: the files are served brotli-compressed and counted here
	 * decompressed, so believing the header names a size a quarter of the truth
	 * and then walks past it while the writer watches.
	 */
	readonly bytesExpected: number;
	onProgress(progress: DownloadProgress): void;
	assets?: EngineAssets;
}

export const openEngine = async ({
	base,
	tag,
	bytesExpected,
	onProgress,
	assets = browserAssets,
}: EngineRequest): Promise<EngineResult> => {
	const dictionary = `${base}dictionaries/${tag}`;
	const answers = await Promise.all([
		download(assets, `${base}hunspell.wasm`),
		download(assets, `${dictionary}/index.aff`),
		download(assets, `${dictionary}/index.dic`),
	]);
	for (const answer of answers) if (!answer.ok) return answer;
	const responses = answers
		.filter((answer) => answer.ok)
		.map((answer) => answer.value);

	let bytesLoaded = 0;
	const report = (added: number): void => {
		bytesLoaded += added;
		onProgress({
			bytesLoaded,
			bytesTotal: Math.max(bytesExpected, bytesLoaded),
		});
	};
	report(0);

	const [wasm, aff, dic] = await Promise.all(
		responses.map((response) => readBody(response, report)),
	);

	const loaded = await attempt(
		assets.loadFactory(`${base}hunspell.mjs`),
		"download",
		(message) => `${base}hunspell.mjs could not be loaded: ${message}`,
	);
	if (!loaded.ok) return loaded;
	if (!isFactory(loaded.value)) {
		return failure("engine", `${base}hunspell.mjs exports no engine`);
	}

	const started = await attempt(
		loaded.value.default({
			instantiateWasm: (imports, ready) => {
				WebAssembly.instantiate(wasm, imports).then((built) => {
					ready(built.instance, built.module);
				});
				return {};
			},
		}),
		"engine",
		(message) => `the engine did not start: ${message}`,
	);
	if (!started.ok) return started;
	const engine = started.value;

	engine.FS.writeFile("/index.aff", aff);
	engine.FS.writeFile("/index.dic", dic);
	const affPath = engine.stringToNewUTF8("/index.aff");
	const dicPath = engine.stringToNewUTF8("/index.dic");
	const handle = engine._remit_open(affPath, dicPath);
	engine._free(affPath);
	engine._free(dicPath);
	if (handle === 0) {
		return failure("engine", `the ${tag} dictionary did not load`);
	}

	const withWord = <T>(word: string, use: (pointer: number) => T): T => {
		const pointer = engine.stringToNewUTF8(word);
		try {
			return use(pointer);
		} finally {
			engine._free(pointer);
		}
	};

	let open = true;
	return {
		ok: true,
		engine: {
			spell: (word) =>
				open && withWord(word, (at) => engine._remit_spell(handle, at) !== 0),
			suggest: (word) => {
				if (!open) return [];
				const answer = withWord(word, (at) =>
					engine._remit_suggest(handle, at),
				);
				if (answer === 0) return [];
				const joined = engine.UTF8ToString(answer);
				engine._free(answer);
				return joined === "" ? [] : joined.split("\n");
			},
			add: (word) => {
				if (open) withWord(word, (at) => engine._remit_add(handle, at));
			},
			close: () => {
				if (!open) return;
				open = false;
				engine._remit_close(handle);
			},
		},
	};
};
