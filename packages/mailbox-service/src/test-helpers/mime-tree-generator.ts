/**
 * Deterministic random MIME tree generator for the body-part mapper
 * property test (issue #395 PR C).
 *
 * Three pieces:
 *
 *   1. `createRng(seed)` — small xorshift32 PRNG. Same seed → same sequence
 *      so failing CI runs reproduce locally via `MAPPER_PROPERTY_SEED`.
 *
 *   2. `generateMimeTree(rng, opts)` — synthesise a random tree:
 *        - root is either a leaf or a `multipart/<mixed|alternative|related>`
 *        - multiparts have N ∈ [1, 5] children
 *        - each child is leaf or multipart, depth capped at `maxDepth` (4)
 *        - leaves draw uniformly from a fixed set of media types
 *        - some leaves get a `dispositionFilename`, some a `contentId`,
 *          some both, most neither
 *        - leaves are mostly non-empty; a small fraction get zero bytes to
 *          exercise the empty-leaf short-circuit in the mapper
 *
 *   3. `renderEml(tree)` + `treeToBodyParts(tree)` — produce a paired
 *      `.eml` string and the `MapperInput[]` rows the mime-walker would
 *      emit for that tree. Both walk the same tree, so partPath, content
 *      type, filename and contentId stay aligned by construction.
 *
 * No external deps. Built on Node primitives only (`node:buffer`,
 * `node:string_decoder` via `Buffer.from(..., 'base64')`).
 */

import { Buffer } from "node:buffer";
import type { BodyPartItem } from "@remit/remit-electrodb-service";

export type MapperInput = Pick<
	BodyPartItem,
	| "partPath"
	| "isMultipart"
	| "mediaType"
	| "mediaSubtype"
	| "contentId"
	| "dispositionFilename"
	| "disposition"
> & { sizeOctets?: number };

/** Tiny xorshift32 PRNG. `next()` returns a float in [0, 1). */
export interface Rng {
	next(): number;
	int(maxExclusive: number): number;
	pick<T>(items: readonly T[]): T;
	bool(probability: number): boolean;
}

export const createRng = (seed: number): Rng => {
	// xorshift32 needs a non-zero 32-bit state.
	let state = (seed | 0) === 0 ? 0xc0dec0de | 0 : seed | 0;

	const next = (): number => {
		state ^= state << 13;
		state ^= state >>> 17;
		state ^= state << 5;
		// Map signed-int range to [0, 1).
		return ((state >>> 0) % 0xffffffff) / 0xffffffff;
	};

	return {
		next,
		int: (maxExclusive: number) => Math.floor(next() * maxExclusive),
		pick: <T>(items: readonly T[]): T =>
			items[Math.floor(next() * items.length)],
		bool: (probability: number) => next() < probability,
	};
};

/* -------------------------------------------------------------------- */
/* Tree shape                                                           */
/* -------------------------------------------------------------------- */

export type MultipartSubtypeName = "mixed" | "alternative" | "related";

export type LeafContentType =
	| "text/plain"
	| "text/html"
	| "application/pdf"
	| "image/png"
	| "application/octet-stream";

export interface LeafNode {
	kind: "leaf";
	contentType: LeafContentType;
	/** Decoded body bytes the renderer will encode into the EML. */
	bytes: Buffer;
	/** Optional `filename=` attribute on the leaf. */
	filename?: string;
	/** Optional `Content-ID:` header value (without angle brackets). */
	contentId?: string;
	/** "inline" or "attachment" Content-Disposition. */
	disposition?: "inline" | "attachment";
}

export interface MultipartNode {
	kind: "multipart";
	subtype: MultipartSubtypeName;
	children: MimeTreeNode[];
}

export type MimeTreeNode = LeafNode | MultipartNode;

const LEAF_CONTENT_TYPES: readonly LeafContentType[] = [
	"text/plain",
	"text/html",
	"application/pdf",
	"image/png",
	"application/octet-stream",
];

const MULTIPART_SUBTYPES: readonly MultipartSubtypeName[] = [
	"mixed",
	"alternative",
	"related",
];

export interface GenerateOptions {
	maxDepth?: number;
	/** Probability the root is a multipart (vs. a single flat leaf). */
	rootMultipartProb?: number;
	/** Probability an empty buffer is used for a leaf body. */
	emptyLeafProb?: number;
}

const DEFAULT_OPTS: Required<GenerateOptions> = {
	maxDepth: 4,
	rootMultipartProb: 0.85,
	emptyLeafProb: 0.05,
};

const extensionFor = (contentType: LeafContentType): string => {
	switch (contentType) {
		case "text/plain":
			return "txt";
		case "text/html":
			return "html";
		case "application/pdf":
			return "pdf";
		case "image/png":
			return "png";
		case "application/octet-stream":
			return "bin";
	}
};

const randomBasename = (rng: Rng): string => {
	// Short ASCII basename — keeps the EML readable.
	const letters = "abcdefghijklmnopqrstuvwxyz";
	const len = 3 + rng.int(5);
	let s = "";
	for (let i = 0; i < len; i++) s += letters[rng.int(letters.length)];
	return s;
};

const generateLeafBytes = (
	rng: Rng,
	partPath: string,
	contentType: LeafContentType,
	emptyLeafProb: number,
): Buffer => {
	if (rng.bool(emptyLeafProb)) return Buffer.alloc(0);
	return Buffer.from(`leaf-${partPath}-${contentType}`, "utf8");
};

const buildLeaf = (
	rng: Rng,
	partPath: string,
	emptyLeafProb: number,
): LeafNode => {
	const contentType = rng.pick(LEAF_CONTENT_TYPES);
	const bytes = generateLeafBytes(rng, partPath, contentType, emptyLeafProb);

	const leaf: LeafNode = { kind: "leaf", contentType, bytes };

	const ext = extensionFor(contentType);
	const isTextStar = contentType.startsWith("text/");

	// Random attachment metadata:
	//   - ~25% get a filename (more common on non-text leaves)
	//   - ~10% get a contentId (image/inline-style)
	//   - text/plain and text/html mostly stay bare (they route via parsed.text/html)
	const wantsFilename = isTextStar ? rng.bool(0.05) : rng.bool(0.45);
	const wantsContentId = rng.bool(0.15);

	if (wantsFilename) {
		leaf.filename = `${randomBasename(rng)}.${ext}`;
		leaf.disposition = rng.bool(0.5) ? "attachment" : "inline";
	}
	if (wantsContentId) {
		leaf.contentId = `${randomBasename(rng)}@example.org`;
		// inline content-id attachments are conventionally inline.
		if (!leaf.disposition) leaf.disposition = "inline";
	}

	return leaf;
};

/**
 * Decay child probability with depth: at depth 4 (max), all children are
 * leaves to guarantee termination.
 */
const childMultipartProb = (depth: number, maxDepth: number): number => {
	if (depth >= maxDepth - 1) return 0;
	// 0.6 → 0.4 → 0.2 → 0 from depth 0 outward.
	const slots = maxDepth - 1;
	const remaining = slots - depth;
	return Math.max(0, (remaining / slots) * 0.6);
};

const buildMultipart = (
	rng: Rng,
	depth: number,
	maxDepth: number,
	emptyLeafProb: number,
	partPath: string,
): MultipartNode => {
	const subtype = rng.pick(MULTIPART_SUBTYPES);
	const childCount = 1 + rng.int(5); // [1, 5]
	const childMpProb = childMultipartProb(depth, maxDepth);

	const children: MimeTreeNode[] = [];
	for (let i = 0; i < childCount; i++) {
		const childPath = partPath === "0" ? String(i + 1) : `${partPath}.${i + 1}`;
		const childIsMultipart = rng.bool(childMpProb);
		if (childIsMultipart) {
			children.push(
				buildMultipart(rng, depth + 1, maxDepth, emptyLeafProb, childPath),
			);
		} else {
			children.push(buildLeaf(rng, childPath, emptyLeafProb));
		}
	}

	return { kind: "multipart", subtype, children };
};

export const generateMimeTree = (
	rng: Rng,
	opts: GenerateOptions = {},
): MimeTreeNode => {
	const o = { ...DEFAULT_OPTS, ...opts };
	const rootIsMultipart = rng.bool(o.rootMultipartProb);
	if (!rootIsMultipart) {
		return buildLeaf(rng, "0", o.emptyLeafProb);
	}
	return buildMultipart(rng, 0, o.maxDepth, o.emptyLeafProb, "0");
};

/* -------------------------------------------------------------------- */
/* BodyPart projection                                                  */
/* -------------------------------------------------------------------- */

const splitContentType = (
	contentType: string,
): { mediaType: MapperInput["mediaType"]; mediaSubtype: string } => {
	const [top, sub] = contentType.split("/");
	const map: Record<string, MapperInput["mediaType"]> = {
		text: "TEXT" as MapperInput["mediaType"],
		image: "IMAGE" as MapperInput["mediaType"],
		application: "APPLICATION" as MapperInput["mediaType"],
		multipart: "MULTIPART" as MapperInput["mediaType"],
	};
	const mediaType = map[top];
	if (!mediaType) {
		throw new Error(`mime-tree-generator: unknown top-level type "${top}"`);
	}
	return { mediaType, mediaSubtype: sub };
};

/**
 * Walk the tree the same way `mime-walker.ts` would and emit
 * `MapperInput[]` in declaration order. Root path is "0"; subsequent
 * leaves are "1", "2", "1.1", "1.2", ... — matches `walkMimeStructure`.
 */
export const treeToBodyParts = (tree: MimeTreeNode): MapperInput[] => {
	const out: MapperInput[] = [];

	const visit = (node: MimeTreeNode, partPath: string): void => {
		if (node.kind === "leaf") {
			const { mediaType, mediaSubtype } = splitContentType(node.contentType);
			const row: MapperInput = {
				partPath,
				isMultipart: false,
				mediaType,
				mediaSubtype,
				sizeOctets: node.bytes.length,
				...(node.filename ? { dispositionFilename: node.filename } : {}),
				...(node.contentId ? { contentId: node.contentId } : {}),
				...(node.disposition ? { disposition: node.disposition } : {}),
			};
			out.push(row);
			return;
		}

		out.push({
			partPath,
			isMultipart: true,
			mediaType: "MULTIPART" as MapperInput["mediaType"],
			mediaSubtype: node.subtype,
		});
		for (let i = 0; i < node.children.length; i++) {
			const childPath =
				partPath === "0" ? String(i + 1) : `${partPath}.${i + 1}`;
			visit(node.children[i], childPath);
		}
	};

	visit(tree, "0");
	return out;
};

/* -------------------------------------------------------------------- */
/* EML renderer                                                         */
/* -------------------------------------------------------------------- */

/**
 * Render a buffer as quoted-printable in a very conservative dialect:
 * ASCII printable stays raw, anything else hex-encoded. Line length
 * limit ignored — fixtures are short enough that no fold is needed for
 * our property test. (mailparser tolerates long QP lines.)
 */
const encodeQuotedPrintable = (buf: Buffer): string => {
	let out = "";
	for (const b of buf) {
		if (b === 0x09 || b === 0x20 || (b >= 0x21 && b <= 0x7e && b !== 0x3d)) {
			out += String.fromCharCode(b);
		} else if (b === 0x0a) {
			out += "\r\n";
		} else {
			out += `=${b.toString(16).toUpperCase().padStart(2, "0")}`;
		}
	}
	return out;
};

const encodeBase64 = (buf: Buffer): string => {
	const b64 = buf.toString("base64");
	// Wrap at 76 columns per RFC 2045.
	const lines: string[] = [];
	for (let i = 0; i < b64.length; i += 76) lines.push(b64.slice(i, i + 76));
	return lines.join("\r\n");
};

const transferEncodingFor = (
	contentType: LeafContentType,
): "7bit" | "base64" | "quoted-printable" => {
	if (contentType === "text/plain") return "quoted-printable";
	if (contentType === "text/html") return "7bit";
	return "base64";
};

const renderLeaf = (leaf: LeafNode): string => {
	const lines: string[] = [];

	const params: string[] = [];
	if (leaf.contentType.startsWith("text/")) params.push("charset=us-ascii");
	if (leaf.filename) params.push(`name="${leaf.filename}"`);
	const ctypeLine =
		params.length > 0
			? `Content-Type: ${leaf.contentType}; ${params.join("; ")}`
			: `Content-Type: ${leaf.contentType}`;
	lines.push(ctypeLine);

	const cte = transferEncodingFor(leaf.contentType);
	lines.push(`Content-Transfer-Encoding: ${cte}`);

	if (leaf.disposition) {
		const dispLine = leaf.filename
			? `Content-Disposition: ${leaf.disposition}; filename="${leaf.filename}"`
			: `Content-Disposition: ${leaf.disposition}`;
		lines.push(dispLine);
	}
	if (leaf.contentId) {
		lines.push(`Content-ID: <${leaf.contentId}>`);
	}

	let body = "";
	if (leaf.bytes.length > 0) {
		if (cte === "base64") body = encodeBase64(leaf.bytes);
		else if (cte === "quoted-printable")
			body = encodeQuotedPrintable(leaf.bytes);
		else body = leaf.bytes.toString("utf8");
	}

	lines.push("");
	lines.push(body);
	return lines.join("\r\n");
};

/**
 * Deterministic boundary derived from the seed + node path. Each
 * multipart node gets its own unique boundary so nested rendering is
 * unambiguous.
 */
const boundaryFor = (seed: number, partPath: string): string =>
	`=_b_${seed.toString(16)}_${partPath.replace(/\./g, "_")}_=`;

const renderNode = (
	node: MimeTreeNode,
	partPath: string,
	seed: number,
): string => {
	if (node.kind === "leaf") return renderLeaf(node);

	const boundary = boundaryFor(seed, partPath);
	const out: string[] = [];
	out.push(`Content-Type: multipart/${node.subtype}; boundary="${boundary}"`);
	out.push("");
	for (let i = 0; i < node.children.length; i++) {
		const childPath = partPath === "0" ? String(i + 1) : `${partPath}.${i + 1}`;
		out.push(`--${boundary}`);
		out.push(renderNode(node.children[i], childPath, seed));
	}
	out.push(`--${boundary}--`);
	out.push("");
	return out.join("\r\n");
};

export interface RenderOptions {
	seed: number;
	subject?: string;
	from?: string;
	to?: string;
	messageId?: string;
}

export const renderEml = (tree: MimeTreeNode, opts: RenderOptions): string => {
	const headers: string[] = [];
	headers.push(`From: ${opts.from ?? "alice@example.org"}`);
	headers.push(`To: ${opts.to ?? "bob@example.org"}`);
	headers.push(`Subject: ${opts.subject ?? `property-${opts.seed}`}`);
	headers.push("Date: Thu, 28 May 2026 09:00:00 +0000");
	headers.push(
		`Message-Id: <${opts.messageId ?? `property-${opts.seed}@example.org`}>`,
	);
	headers.push("MIME-Version: 1.0");

	if (tree.kind === "leaf") {
		// Flat single-leaf message: leaf headers merge with the envelope.
		const leafRendered = renderLeaf(tree);
		// Drop the duplicate trailing newlines and merge.
		return `${headers.join("\r\n")}\r\n${leafRendered}\r\n`;
	}

	const boundary = boundaryFor(opts.seed, "0");
	const out: string[] = [];
	out.push(...headers);
	out.push(`Content-Type: multipart/${tree.subtype}; boundary="${boundary}"`);
	out.push("");
	for (let i = 0; i < tree.children.length; i++) {
		const childPath = String(i + 1);
		out.push(`--${boundary}`);
		out.push(renderNode(tree.children[i], childPath, opts.seed));
	}
	out.push(`--${boundary}--`);
	out.push("");
	return out.join("\r\n");
};
