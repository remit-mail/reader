#!/usr/bin/env node
import { readdir, readFile } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
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

const STORY_FILE = /\.stories\.tsx?$/;

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
	return JSON.parse(
		`"${text.slice(start + 1, end - 1).replaceAll('"', '\\"')}"`,
	);
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

export function checkStory({ path, source }) {
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
	return problems;
}

async function findStories(root) {
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
			if (STORY_FILE.test(entry.name)) found.push(relative(root, full));
		}
	};
	for (const packageRoot of Object.keys(PACKAGE_ROOTS)) {
		await walk(join(root, packageRoot));
	}
	return found.sort();
}

export async function checkRepo(root) {
	const paths = await findStories(root);
	if (paths.length === 0) return { count: 0, problems: ["no stories found"] };
	const problems = [];
	for (const path of paths) {
		const source = await readFile(join(root, path), "utf8");
		problems.push(...checkStory({ path, source }));
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
