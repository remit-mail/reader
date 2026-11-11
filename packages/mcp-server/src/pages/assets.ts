export const ASSETS_PATH_PREFIX = "/assets/";
export const STYLESHEET_PATH = `${ASSETS_PATH_PREFIX}pages.css`;

export interface PageAsset {
	body: Uint8Array<ArrayBuffer>;
	contentType: string;
}

export type PageAssets = ReadonlyMap<string, PageAsset>;

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
