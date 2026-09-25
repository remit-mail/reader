#!/usr/bin/env node
import { readdir, readFile } from "node:fs/promises";
import { dirname, join, posix, relative } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const DESIGN_SYSTEM = "Design System/";
export const SHIPPED = "Playground/Shipped/";
export const PROPOSED = "Playground/Proposed/";
export const PROPOSED_TAG = "proposed";

export const PACKAGE_ROOTS = {
	"packages/ui/src": [DESIGN_SYSTEM, SHIPPED, PROPOSED],
	"packages/web-client/src": [SHIPPED],
	"packages/workbench/src": [PROPOSED],
};

const ESCAPES = new Map([
	['"', '"'],
	["'", "'"],
	["\\", "\\"],
	["n", "\n"],
	["t", "\t"],
]);
const STORY_FILE = /\.stories\.tsx?$/;
const SOURCE_FILE = /\.tsx?$/;
const NOT_APP_SOURCE = /\.(?:stories|test)\.tsx?$|fixtures|\/test-support\//;
const NOT_A_SUBJECT = /\.stories\.tsx?$|fixtures/;
export const UI_SOURCE = "packages/ui/src";
export const WEB_CLIENT_SOURCE = "packages/web-client/src";
const UI_PACKAGE = "packages/ui";
const UI_PACKAGE_NAME = "@remit/ui";
const REGEX_AFTER = new Set([..."(,=:[!&|?{};+-*%<>~^"]);
const REGEX_AFTER_KEYWORD =
	/(?:^|[^\w$])(?:return|typeof|case|in|of|delete|void|throw|new|else|do|await|yield)\s*$/;
const STATIC_IMPORT =
	/^[ \t]*(import|export)\s+(type\s+)?([\w$*{}\s,]*?)\s*from\s*(["'])([^"'\n]*)\4/dgm;
const SIDE_EFFECT_IMPORT = /^[ \t]*import\s*(["'])([^"'\n]*)\1/dgm;
const DYNAMIC_IMPORT = /(?<![\w$.])import\s*\(\s*(["'])([^"'\n]*)\1\s*\)/dg;

function skipQuoted(source, start) {
	const quote = source[start];
	let i = start + 1;
	while (i < source.length && source[i] !== quote) {
		if (source[i] === "\\") i++;
		i++;
	}
	return i + 1;
}

function skipComment(source, start) {
	if (source[start + 1] === "/") {
		const end = source.indexOf("\n", start);
		return end === -1 ? source.length : end;
	}
	const end = source.indexOf("*/", start + 2);
	return end === -1 ? source.length : end + 2;
}

function isCommentStart(source, i) {
	return source[i] === "/" && (source[i + 1] === "/" || source[i + 1] === "*");
}

function objectLiteralAt(source, open) {
	let depth = 0;
	let i = open;
	while (i < source.length) {
		const char = source[i];
		if (char === '"' || char === "'" || char === "`") {
			i = skipQuoted(source, i);
			continue;
		}
		if (isCommentStart(source, i)) {
			i = skipComment(source, i);
			continue;
		}
		if (char === "{" || char === "[" || char === "(") depth++;
		if (char === "}" || char === "]" || char === ")") {
			depth--;
			if (depth === 0) return source.slice(open, i + 1);
		}
		i++;
	}
	return null;
}

function topLevelProperty(object, name) {
	let depth = 0;
	let i = 0;
	while (i < object.length) {
		const char = object[i];
		if (char === '"' || char === "'" || char === "`") {
			i = skipQuoted(object, i);
			continue;
		}
		if (isCommentStart(object, i)) {
			i = skipComment(object, i);
			continue;
		}
		if (char === "{" || char === "[" || char === "(") depth++;
		if (char === "}" || char === "]" || char === ")") depth--;
		if (depth === 1 && object.startsWith(name, i)) {
			const match = new RegExp(`^${name}\\s*:\\s*`).exec(object.slice(i));
			const before = object[i - 1];
			if (match && !/[\w$]/.test(before)) return i + match[0].length;
		}
		i++;
	}
	return null;
}

function stringLiteralAt(text, start) {
	const quote = text[start];
	if (quote !== '"' && quote !== "'") return null;
	const end = skipQuoted(text, start);
	if (text[end - 1] !== quote) return null;
	let value = "";
	for (let i = start + 1; i < end - 1; i++) {
		if (text[i] !== "\\") {
			value += text[i];
			continue;
		}
		i++;
		if (!ESCAPES.has(text[i])) return null;
		value += ESCAPES.get(text[i]);
	}
	return value;
}

function stringArrayAt(text, start) {
	if (text[start] !== "[") return null;
	const values = [];
	let i = start + 1;
	while (i < text.length) {
		while (/[\s,]/.test(text[i])) i++;
		if (text[i] === "]") return values;
		const value = stringLiteralAt(text, i);
		if (value === null) return null;
		values.push(value);
		i = skipQuoted(text, i);
	}
	return null;
}

export function readMeta(source) {
	const exported = /export\s+default\s+([A-Za-z_$][\w$]*)\s*;/.exec(source);
	if (!exported) return { error: "no `export default <meta>` found" };
	const declaration = new RegExp(
		`(?:const|let)\\s+${exported[1]}\\b[^=]*=\\s*\\{`,
	).exec(source);
	if (!declaration) {
		return { error: `no object literal assigned to \`${exported[1]}\`` };
	}
	const object = objectLiteralAt(
		source,
		declaration.index + declaration[0].length - 1,
	);
	if (object === null) return { error: "unterminated meta object" };
	const titleAt = topLevelProperty(object, "title");
	const title = titleAt === null ? null : stringLiteralAt(object, titleAt);
	if (title === null) return { error: "meta has no string literal `title`" };
	const tagsAt = topLevelProperty(object, "tags");
	if (tagsAt === null) return { title, tags: [] };
	const tags = stringArrayAt(object, tagsAt);
	if (tags === null) {
		return { error: "meta `tags` is not an array of string literals" };
	}
	return { title, tags };
}

export function checkStory({ path, source, mounted }) {
	const packageRoot = Object.keys(PACKAGE_ROOTS).find((root) =>
		path.startsWith(`${root}/`),
	);
	if (packageRoot === undefined) {
		return [
			`${path}: story lives outside ${Object.keys(PACKAGE_ROOTS).join(", ")}`,
		];
	}
	const meta = readMeta(source);
	if ("error" in meta) return [`${path}: ${meta.error}`];
	const allowed = PACKAGE_ROOTS[packageRoot];
	const root = allowed.find((prefix) => meta.title.startsWith(prefix));
	const problems = [];
	if (root === undefined || meta.title.length === root.length) {
		problems.push(
			`${path}: title "${meta.title}" must sit under ${allowed.map((prefix) => `"${prefix}<name>"`).join(" or ")}`,
		);
	}
	if (meta.title.startsWith(PROPOSED) && !meta.tags.includes(PROPOSED_TAG)) {
		problems.push(`${path}: "${meta.title}" needs the "${PROPOSED_TAG}" tag`);
	}
	if (mounted === undefined) return problems;
	const tagged = meta.tags.includes(PROPOSED_TAG);
	if (mounted && tagged) {
		problems.push(
			`${path}: web-client mounts this component, so it cannot carry the "${PROPOSED_TAG}" tag`,
		);
	}
	if (!mounted && !tagged) {
		problems.push(
			`${path}: no web-client source mounts this component, so it needs the "${PROPOSED_TAG}" tag`,
		);
	}
	return problems;
}

function blankRange(out, from, to) {
	for (let i = from; i < to && i < out.length; i++) {
		if (out[i] !== "\n") out[i] = " ";
	}
}

function closeOnLine(source, start, close) {
	let i = start + 1;
	let inClass = false;
	while (i < source.length && source[i] !== "\n") {
		const char = source[i];
		if (char === "\\") {
			i += 2;
			continue;
		}
		if (close === "/" && char === "[") inClass = true;
		if (close === "/" && char === "]") inClass = false;
		if (char === close && !inClass) return i + 1;
		i++;
	}
	return -1;
}

function regexAllowed(source, i, previous) {
	if (previous === "" || REGEX_AFTER.has(previous)) return true;
	return REGEX_AFTER_KEYWORD.test(source.slice(Math.max(0, i - 12), i));
}

export function codeOf(source) {
	const out = source.split("");
	const scanTemplate = (start) => {
		let i = start + 1;
		while (i < source.length) {
			if (source[i] === "`") return i + 1;
			if (source[i] === "$" && source[i + 1] === "{") {
				blankRange(out, i, i + 2);
				i = scanCode(i + 2, true);
				continue;
			}
			const step = source[i] === "\\" ? 2 : 1;
			blankRange(out, i, i + step);
			i += step;
		}
		return i;
	};
	const scanCode = (start, untilBrace) => {
		let depth = 0;
		let previous = "";
		let i = start;
		while (i < source.length) {
			const char = source[i];
			if (isCommentStart(source, i)) {
				const end = skipComment(source, i);
				blankRange(out, i, end);
				i = end;
				continue;
			}
			if (char === "`") {
				i = scanTemplate(i);
				previous = char;
				continue;
			}
			const quoted =
				(char === '"' || char === "'") && !/[\w$]/.test(source[i - 1] ?? "");
			const end = quoted
				? closeOnLine(source, i, char)
				: char === "/" && regexAllowed(source, i, previous)
					? closeOnLine(source, i, "/")
					: -1;
			if (end !== -1) {
				blankRange(out, i + 1, end - 1);
				i = end;
				previous = char;
				continue;
			}
			if (char === "{") depth++;
			if (char === "}") {
				if (untilBrace && depth === 0) return i + 1;
				depth--;
			}
			if (!/\s/.test(char)) previous = char;
			i++;
		}
		return i;
	};
	scanCode(0, false);
	return out.join("");
}

function bindingsOf(clause) {
	const bindings = [];
	const named = /\{([^}]*)\}/.exec(clause);
	const outside = clause
		.replace(/\{[^}]*\}/, "")
		.split(",")
		.map((part) => part.trim())
		.filter(Boolean);
	for (const part of outside) {
		const star = /^\*(?:\s+as\s+([\w$]+))?$/.exec(part);
		if (star) {
			bindings.push({ imported: "*", local: star[1] ?? "*" });
			continue;
		}
		bindings.push({ imported: "default", local: part });
	}
	if (named === null) return bindings;
	for (const part of named[1].split(",").map((entry) => entry.trim())) {
		if (part === "" || /^type\s/.test(part)) continue;
		const [imported, local = imported] = part.split(/\s+as\s+/);
		bindings.push({ imported, local });
	}
	return bindings;
}

export function importsOf(source) {
	const code = codeOf(source);
	const entries = [];
	const specifierAt = (match, group) =>
		source.slice(match.indices[group][0], match.indices[group][1]);
	for (const match of code.matchAll(STATIC_IMPORT)) {
		if (match[2] !== undefined) continue;
		const bindings = bindingsOf(match[3]);
		if (bindings.length === 0) continue;
		entries.push({
			kind: match[1],
			specifier: specifierAt(match, 5),
			bindings,
		});
	}
	const whole = [{ imported: "*", local: "*" }];
	for (const pattern of [SIDE_EFFECT_IMPORT, DYNAMIC_IMPORT]) {
		for (const match of code.matchAll(pattern)) {
			entries.push({
				kind: "import",
				specifier: specifierAt(match, 2),
				bindings: whole,
			});
		}
	}
	return entries;
}

function escapeRegExp(text) {
	return text.replace(/[$]/g, "\\$&");
}

function definesLocally(code, name) {
	const declared = new RegExp(
		`^[ \\t]*export\\s+(?:declare\\s+)?(?:default\\s+)?(?:async\\s+)?(?:abstract\\s+)?(?:function\\*?|const|let|var|class|enum)\\s+${escapeRegExp(name)}(?![\\w$])`,
		"m",
	);
	if (declared.test(code)) return true;
	for (const list of code.matchAll(
		/^[ \t]*export\s*\{([^}]*)\}(\s*from\b)?/gm,
	)) {
		if (list[2] !== undefined) continue;
		if (bindingsOf(`{${list[1]}}`).some((binding) => binding.local === name)) {
			return true;
		}
	}
	return false;
}

function moduleGraph(files) {
	const parsed = new Map();
	const parse = (path) => {
		if (!parsed.has(path)) {
			const source = files.get(path);
			parsed.set(path, { code: codeOf(source), entries: importsOf(source) });
		}
		return parsed.get(path);
	};
	const resolve = (from, specifier) => {
		if (!specifier.startsWith(".")) return null;
		const base = posix.join(posix.dirname(from), specifier);
		const stem = base.replace(/\.(?:[cm]?js|jsx)$/, "");
		const candidates = [
			base,
			`${stem}.ts`,
			`${stem}.tsx`,
			`${stem}/index.ts`,
			`${stem}/index.tsx`,
		];
		return candidates.find((candidate) => files.has(candidate)) ?? null;
	};
	const resolveExport = (file, name, seen = new Set()) => {
		const key = `${file}#${name}`;
		if (seen.has(key)) return null;
		seen.add(key);
		const { code, entries } = parse(file);
		const stars = [];
		for (const entry of entries) {
			if (entry.kind !== "export") continue;
			for (const binding of entry.bindings) {
				if (binding.local === "*") {
					stars.push(entry.specifier);
					continue;
				}
				if (binding.local !== name) continue;
				const target = resolve(file, entry.specifier);
				if (target === null) return entry.specifier.startsWith(".") ? null : [];
				if (binding.imported === "*") return [target];
				return resolveExport(target, binding.imported, seen);
			}
		}
		if (definesLocally(code, name)) return [file];
		for (const specifier of stars) {
			const target = resolve(file, specifier);
			if (target === null) continue;
			const found = resolveExport(target, name, seen);
			if (found !== null) return found;
		}
		return null;
	};
	return { parse, resolve, resolveExport };
}

export function mountedUiModules(files, entryPoints) {
	const graph = moduleGraph(files);
	const seeds = [];
	const problems = [];
	for (const path of files.keys()) {
		if (!path.startsWith(`${WEB_CLIENT_SOURCE}/`)) continue;
		if (NOT_APP_SOURCE.test(path)) continue;
		for (const entry of graph.parse(path).entries) {
			const entryFile = entryPoints.get(entry.specifier);
			if (entryFile === undefined) continue;
			for (const { imported } of entry.bindings) {
				if (imported === "*" || imported === "default") {
					seeds.push(entryFile);
					continue;
				}
				const found = graph.resolveExport(entryFile, imported);
				if (found === null) {
					problems.push(
						`${path}: cannot trace "${imported}" through ${entry.specifier}`,
					);
					continue;
				}
				seeds.push(...found);
			}
		}
	}
	const mounted = new Set();
	while (seeds.length > 0) {
		const file = seeds.pop();
		if (mounted.has(file)) continue;
		mounted.add(file);
		for (const entry of graph.parse(file).entries) {
			const target = graph.resolve(file, entry.specifier);
			if (target?.startsWith(`${UI_SOURCE}/`)) seeds.push(target);
		}
	}
	return { mounted, problems };
}

export function storySubjects(files, path) {
	const stem = path.replace(STORY_FILE, "");
	const sibling = [`${stem}.tsx`, `${stem}.ts`].find((file) => files.has(file));
	if (sibling !== undefined) return [sibling];
	const graph = moduleGraph(files);
	return graph
		.parse(path)
		.entries.map((entry) => graph.resolve(path, entry.specifier))
		.filter((file) => file?.startsWith(`${UI_SOURCE}/`))
		.filter((file) => !NOT_A_SUBJECT.test(file));
}

export function uiEntryPoints(manifest) {
	const entryPoints = new Map();
	for (const [subpath, target] of Object.entries(manifest.exports)) {
		if (!SOURCE_FILE.test(target)) continue;
		entryPoints.set(
			posix.join(UI_PACKAGE_NAME, subpath),
			posix.join(UI_PACKAGE, target),
		);
	}
	return entryPoints;
}

async function findFiles(root, directories, pattern) {
	const found = [];
	const walk = async (current) => {
		const entries = await readdir(current, { withFileTypes: true });
		for (const entry of entries) {
			if (entry.name === "node_modules") continue;
			const full = join(current, entry.name);
			if (entry.isDirectory()) {
				await walk(full);
				continue;
			}
			if (pattern.test(entry.name)) found.push(relative(root, full));
		}
	};
	for (const directory of directories) {
		await walk(join(root, directory));
	}
	return found.sort();
}

async function readSources(root) {
	const paths = await findFiles(
		root,
		[UI_SOURCE, WEB_CLIENT_SOURCE],
		SOURCE_FILE,
	);
	const files = new Map();
	for (const path of paths) {
		files.set(path, await readFile(join(root, path), "utf8"));
	}
	return files;
}

export async function checkRepo(root) {
	const paths = await findFiles(root, Object.keys(PACKAGE_ROOTS), STORY_FILE);
	if (paths.length === 0) return { count: 0, problems: ["no stories found"] };
	const files = await readSources(root);
	const manifest = JSON.parse(
		await readFile(join(root, UI_PACKAGE, "package.json"), "utf8"),
	);
	const { mounted, problems } = mountedUiModules(
		files,
		uiEntryPoints(manifest),
	);
	for (const path of paths) {
		const source = await readFile(join(root, path), "utf8");
		const isUi = path.startsWith(`${UI_SOURCE}/`);
		const subjects = isUi ? storySubjects(files, path) : [];
		problems.push(
			...checkStory({
				path,
				source,
				mounted: isUi
					? subjects.some((subject) => mounted.has(subject))
					: undefined,
			}),
		);
	}
	return { count: paths.length, problems };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
	const root = join(dirname(fileURLToPath(import.meta.url)), "..");
	const { count, problems } = await checkRepo(root);
	if (problems.length > 0) {
		console.error(problems.join("\n"));
		console.error(`\n${problems.length} storybook title problem(s)`);
		process.exitCode = 1;
	} else {
		console.log(`${count} story files sit under their package's roots`);
	}
}
