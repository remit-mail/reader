import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
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

const isInside = (dir, fileName) => fileName.startsWith(`${dir}/`);

const isSource = (fileName) =>
	TYPESCRIPT.test(fileName) && !DECLARATION.test(fileName);

const declarationPath = (fileName) =>
	fileName.replace(/\.([cm]?)tsx?$/, (_, flavour) => `.d.${flavour}ts`);

const EMIT_DECLARATIONS = {
	declaration: true,
	emitDeclarationOnly: true,
	noEmitOnError: false,
	noEmit: false,
	composite: false,
	incremental: false,
	declarationMap: false,
	sourceMap: false,
	skipLibCheck: true,
	outDir: undefined,
	rootDir: undefined,
	declarationDir: undefined,
};

// A package's tsconfig extends the repository's, which the tarball does not
// carry, so the caller supplies the base options and the package's own
// compilerOptions apply on top of them.
const sourceOptions = (ts, packageDir, baseOptions) => {
	const configPath = join(packageDir, "tsconfig.json");
	const own = existsSync(configPath)
		? ts.convertCompilerOptionsFromJson(
				ts.readConfigFile(configPath, ts.sys.readFile).config
					?.compilerOptions ?? {},
				packageDir,
			).options
		: {};
	return { ...baseOptions, ...own, ...EMIT_DECLARATIONS };
};

const UNRESOLVED_MODULE = new Set([2307, 2792]);

const specifierOf = (diagnostic) =>
	diagnostic.file.text
		.slice(diagnostic.start, diagnostic.start + diagnostic.length)
		.replace(/^["']|["']$/g, "");

const unresolvedImports = (program, packageDir, counts) =>
	program
		.getSourceFiles()
		.filter((source) => isInside(packageDir, source.fileName))
		.flatMap((source) => program.getSemanticDiagnostics(source))
		.filter((diagnostic) => UNRESOLVED_MODULE.has(diagnostic.code))
		.filter(counts)
		.map((diagnostic) => ({
			fileName: diagnostic.file.fileName,
			specifier: specifierOf(diagnostic),
		}));

const isRelativeImport = (diagnostic) =>
	specifierOf(diagnostic).startsWith(".");

const emitDeclarations = (ts, packageDir, sourceFiles, baseOptions) => {
	const program = ts.createProgram(
		sourceFiles,
		sourceOptions(ts, packageDir, baseOptions),
	);
	const unresolved = unresolvedImports(program, packageDir, () => true);
	const emitted = new Map();
	const collect = (fileName, text, _bom, _onError, sources) => {
		if (!DECLARATION.test(fileName)) return;
		for (const source of sources ?? []) {
			emitted.set(declarationPath(source.fileName), text);
		}
	};
	for (const source of program.getSourceFiles()) {
		if (!isInside(packageDir, source.fileName) || !isSource(source.fileName))
			continue;
		program.emit(source, collect, undefined, true);
	}
	return { emitted, unresolved };
};

// The package's TypeScript sources are hidden behind the declarations emitted
// from them, so `./x.js` resolves to the emitted `x.d.ts` and not to `x.ts`.
const overlayHost = (ts, options, packageDir, emitted) => {
	const host = ts.createCompilerHost(options);
	const hidden = (fileName) =>
		isInside(packageDir, fileName) && isSource(fileName);
	return {
		...host,
		fileExists: (fileName) =>
			emitted.has(fileName) || (!hidden(fileName) && host.fileExists(fileName)),
		readFile: (fileName) =>
			emitted.get(fileName) ??
			(hidden(fileName) ? undefined : host.readFile(fileName)),
		getSourceFile: (fileName, languageVersion, ...rest) =>
			emitted.has(fileName)
				? ts.createSourceFile(fileName, emitted.get(fileName), languageVersion)
				: host.getSourceFile(fileName, languageVersion, ...rest),
	};
};

// Only declarations inside the package count: a re-export from another
// package is that package's API and its own version.
const printed = (ts, printer, nodes) =>
	nodes
		.map((node) =>
			printer
				.printNode(ts.EmitHint.Unspecified, node, node.getSourceFile())
				.replace(/\s+/g, " ")
				.trim(),
		)
		.sort()
		.join("\n");

const declarationText = (ts, printer, packageDir, symbol) =>
	printed(
		ts,
		printer,
		(symbol.declarations ?? []).filter((node) =>
			isInside(packageDir, node.getSourceFile().fileName),
		),
	);

const MODULE_SYNTAX = new Set([
	"ImportDeclaration",
	"ImportEqualsDeclaration",
	"ExportDeclaration",
	"ExportAssignment",
]);

// A type an export refers to but does not export changes what the export
// accepts or returns without changing its own text, so each declaration
// file's unexported statements are compared as one entry.
const isExported = (ts, statement) =>
	ts.canHaveModifiers(statement) &&
	(ts.getModifiers(statement) ?? []).some(
		(modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword,
	);

const localStatements = (ts, source) =>
	source.statements.filter(
		(statement) =>
			!MODULE_SYNTAX.has(ts.SyntaxKind[statement.kind]) &&
			!isExported(ts, statement),
	);

// `exports` keys are `<subpath> <export name>` and `(local) <declaration
// file>`, values the printed declarations. An entry that is TypeScript source is
// compared through the declarations the compiler emits for it, so
// implementation bodies never count. `unresolved` lists the imports and entries
// the compiler could not read, whose types would otherwise silently be `any`.
export const apiSurface = (ts, packageDir, { baseOptions = {} } = {}) => {
	const manifest = JSON.parse(
		readFileSync(join(packageDir, "package.json"), "utf8"),
	);
	const entries = entryPoints(packageDir, manifest).map(
		({ subpath, file }) => ({ subpath, path: join(packageDir, file) }),
	);
	const exports = new Map();
	const unresolved = [];
	if (entries.length === 0) return { exports, unresolved };

	const sources = entries.map(({ path }) => path).filter(isSource);
	const emit =
		sources.length > 0
			? emitDeclarations(ts, packageDir, sources, baseOptions)
			: { emitted: new Map(), unresolved: [] };
	const declared = entries.map(({ subpath, path }) => ({
		subpath,
		path: isSource(path) ? declarationPath(path) : path,
	}));

	const options = {
		noEmit: true,
		noLib: true,
		types: [],
		module: ts.ModuleKind.ESNext,
		moduleResolution: ts.ModuleResolutionKind.Bundler,
	};
	const program = ts.createProgram(
		declared.map(({ path }) => path),
		options,
		overlayHost(ts, options, packageDir, emit.emitted),
	);

	const subpathOf = new Map(
		entries.flatMap(({ subpath, path }) => [
			[path, subpath],
			[declarationPath(path), subpath],
		]),
	);
	for (const { fileName, specifier } of [
		...emit.unresolved,
		...unresolvedImports(program, packageDir, isRelativeImport),
	]) {
		const where = subpathOf.get(fileName) ?? relative(packageDir, fileName);
		unresolved.push(`${where} ${specifier}`);
	}

	const checker = program.getTypeChecker();
	const printer = ts.createPrinter({ removeComments: true });

	for (const { subpath, path } of declared) {
		const source = program.getSourceFile(path);
		const moduleSymbol = source && checker.getSymbolAtLocation(source);
		if (!moduleSymbol) {
			unresolved.push(`${subpath} ${relative(packageDir, path)}`);
			continue;
		}
		for (const exported of checker.getExportsOfModule(moduleSymbol)) {
			const target =
				exported.flags & ts.SymbolFlags.Alias
					? checker.getAliasedSymbol(exported)
					: exported;
			exports.set(
				`${subpath} ${exported.name}`,
				declarationText(ts, printer, packageDir, target),
			);
		}
	}
	for (const source of program.getSourceFiles()) {
		if (!isInside(packageDir, source.fileName)) continue;
		const locals = localStatements(ts, source);
		if (locals.length === 0) continue;
		exports.set(
			`(local) ${relative(packageDir, source.fileName)}`,
			printed(ts, printer, locals),
		);
	}
	return { exports, unresolved: [...new Set(unresolved)].sort() };
};

// An unresolved import in the fresh pack is a broken build or a broken
// comparison, so it fails the run. In the published version it is the break
// itself: it resolves its siblings against the current workspace, which stops
// resolving the moment a sibling drops a subpath or an export.
export const apiBreaks = (before, after) => {
	if (after.unresolved.length > 0) {
		throw new Error(
			`unresolved in the fresh pack:\n  ${after.unresolved.join("\n  ")}`,
		);
	}
	const breaks = [];
	for (const [key, text] of before.exports) {
		if (!after.exports.has(key)) {
			breaks.push(`removed ${key}`);
			continue;
		}
		if (text !== after.exports.get(key)) {
			breaks.push(`changed ${key}`);
		}
	}
	return [
		...before.unresolved.map((line) => `unresolved ${line}`),
		...breaks.sort(),
	];
};
