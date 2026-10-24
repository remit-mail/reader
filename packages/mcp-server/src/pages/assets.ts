import { existsSync, readdirSync, readFileSync } from "node:fs";
import { extname, join } from "node:path";

export const ASSETS_PATH_PREFIX = "/assets/";
export const STYLESHEET_PATH = `${ASSETS_PATH_PREFIX}pages.css`;

const CONTENT_TYPES: Readonly<Record<string, string>> = {
	".css": "text/css; charset=utf-8",
	".woff2": "font/woff2",
};

export interface PageAsset {
	body: Buffer<ArrayBuffer>;
	contentType: string;
}

export type PageAssets = ReadonlyMap<string, PageAsset>;

export const loadPageAssets = (dir: string): PageAssets => {
	if (!existsSync(join(dir, "pages.css"))) {
		throw new Error(
			`The MCP page stylesheet is missing from ${dir}. Run "npm run build -w @remit/mcp-server" before starting the server.`,
		);
	}
	const assets = new Map<string, PageAsset>();
	for (const name of readdirSync(dir)) {
		const contentType = CONTENT_TYPES[extname(name)];
		if (!contentType) continue;
		assets.set(`${ASSETS_PATH_PREFIX}${name}`, {
			body: readFileSync(join(dir, name)),
			contentType,
		});
	}
	return assets;
};

export const serveAsset = (assets: PageAssets, pathname: string): Response => {
	const asset = assets.get(pathname);
	if (!asset) return new Response("Not found", { status: 404 });
	return new Response(asset.body, {
		headers: {
			"content-type": asset.contentType,
			"cache-control": "public, max-age=3600",
			"x-content-type-options": "nosniff",
		},
	});
};
