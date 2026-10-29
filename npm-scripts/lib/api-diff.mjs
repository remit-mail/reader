import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

const DECLARATION = /\.d\.[cm]?ts$/;
const TYPESCRIPT = /\.[cm]?tsx?$/;
const JAVASCRIPT = /\.([cm]?)js$/;

const posix = (path) => path.split(sep).join("/");

const stripDotSlash = (path) => path.replace(/^\.\//, "");

const packageFiles = (root) => {
	const out = [];
	const recurse = (current) => {
		for (const entry of readdirSync(current)) {
			if (entry === "node_modules") continue;
			const path = join(current, entry);
			if (statSync(path).isDirectory()) recurse(path);
			else out.push(posix(relative(root, path)));
		}
	};
	recurse(root);
	return out.sort();
};

const conditionTargets = (value) => {
	if (typeof value === "string") return [value];
	if (Array.isArray(value)) return value.flatMap(conditionTargets);
	if (value === null || typeof value !== "object") return [];
	const { types, ...rest } = value;
	return [
		...conditionTargets(types),
		...Object.values(rest).flatMap(conditionTargets),
	];
};

const typedTarget = (target) => {
	const path = stripDotSlash(target);
	if (TYPESCRIPT.test(path)) return path;
	return JAVASCRIPT.test(path)
		? path.replace(JAVASCRIPT, (_, flavour) => `.d.${flavour}ts`)
		: null;
};

const subpathMap = (manifest) => {
	const { exports } = manifest;
	if (exports === undefined) {
		const types = manifest.types ?? manifest.typings ?? manifest.main;
		return types ? { ".": types } : {};
	}
	const keyed =
		exports !== null &&
		typeof exports === "object" &&
		!Array.isArray(exports) &&
		Object.keys(exports).some((key) => key.startsWith("."));
	return keyed ? exports : { ".": exports };
};

const expandWildcard = (subpath, patterns, files) => {
	for (const pattern of patterns) {
		const [prefix, suffix] = pattern.split("*");
		const matches = files.filter(
			(file) =>
				file.length >= prefix.length + suffix.length &&
				file.startsWith(prefix) &&
				file.endsWith(suffix),
		);
		if (matches.length === 0) continue;
		return matches.map((file) => ({
			subpath: subpath.replace(
				"*",
				file.slice(prefix.length, file.length - suffix.length),
			),
			file,
		}));
	}
	return [];
};

export const entryPoints = (packageDir, manifest) => {
	const files = packageFiles(packageDir);
	const present = new Set(files);
	const entries = [];
	for (const [subpath, value] of Object.entries(subpathMap(manifest))) {
		const typed = conditionTargets(value).map(typedTarget).filter(Boolean);
		if (subpath.includes("*")) {
			const patterns = typed.filter((target) => target.includes("*"));
			entries.push(...expandWildcard(subpath, patterns, files));
			continue;
		}
		const file = typed.find((target) => present.has(target));
		if (file) entries.push({ subpath, file });
	}
	return entries;
};

const declarationText = (ts, printer, symbol) =>
	(symbol.declarations ?? [])
		.map((node) =>
			printer
				.printNode(ts.EmitHint.Unspecified, node, node.getSourceFile())
				.replace(/\s+/g, " ")
				.trim(),
		)
		.sort()
		.join("\n");

// Keys are `<subpath> <export name>`. The value is the printed declaration, or
// null when the entry is TypeScript source: its text carries implementation
// bodies, so only its export names are compared.
export const apiSurface = (ts, packageDir) => {
	const manifest = JSON.parse(
		readFileSync(join(packageDir, "package.json"), "utf8"),
	);
	const entries = entryPoints(packageDir, manifest);
	const surface = new Map();
	if (entries.length === 0) return surface;

	const program = ts.createProgram(
		entries.map(({ file }) => join(packageDir, file)),
		{
			noEmit: true,
			noLib: true,
			types: [],
			module: ts.ModuleKind.ESNext,
			moduleResolution: ts.ModuleResolutionKind.Bundler,
		},
	);
	const checker = program.getTypeChecker();
	const printer = ts.createPrinter({ removeComments: true });

	for (const { subpath, file } of entries) {
		const source = program.getSourceFile(join(packageDir, file));
		const moduleSymbol = source && checker.getSymbolAtLocation(source);
		if (!moduleSymbol) continue;
		const printed = DECLARATION.test(file);
		for (const exported of checker.getExportsOfModule(moduleSymbol)) {
			const target =
				exported.flags & ts.SymbolFlags.Alias
					? checker.getAliasedSymbol(exported)
					: exported;
			surface.set(
				`${subpath} ${exported.name}`,
				printed ? declarationText(ts, printer, target) : null,
			);
		}
	}
	return surface;
};

export const apiBreaks = (before, after) => {
	const breaks = [];
	for (const [key, text] of before) {
		if (!after.has(key)) {
			breaks.push(`removed ${key}`);
			continue;
		}
		const next = after.get(key);
		if (text !== null && next !== null && text !== next) {
			breaks.push(`changed ${key}`);
		}
	}
	return breaks.sort();
};
