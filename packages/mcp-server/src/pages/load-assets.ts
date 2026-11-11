import { existsSync, readdirSync, readFileSync } from "node:fs";
import { extname, join } from "node:path";
import {
	ASSETS_PATH_PREFIX,
	type PageAsset,
	type PageAssets,
} from "./assets.js";

const CONTENT_TYPES: Readonly<Record<string, string>> = {
	".css": "text/css; charset=utf-8",
	".woff2": "font/woff2",
};

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
