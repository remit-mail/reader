import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { $dfs, mergeRegister } from "@lexical/utils";
import {
	$applyNodeReplacement,
	$createParagraphNode,
	$getNodeByKey,
	$getRoot,
	$insertNodes,
	$isElementNode,
	HISTORY_MERGE_TAG,
	HISTORY_PUSH_TAG,
	type LexicalEditor,
	type NodeKey,
} from "lexical";
import { type RefObject, useEffect } from "react";
import { ImageNode } from "./rich-text-image-node.js";

export interface InlineImagePlacement {
	stored: (file: File, contentId: string) => void;
	failed: (file: File) => void;
}

export interface InlineImages {
	attach: (files: File[], placement?: InlineImagePlacement) => void;
	owns: (contentId: string) => boolean;
	resolve: (contentId: string) => Promise<string | null>;
	onRemoved: (listener: (contentId: string) => void) => () => void;
}

const CONTENT_ID_SOURCE = /^cid:(.+)$/i;

const contentIdOf = (src: string): string | null =>
	CONTENT_ID_SOURCE.exec(src)?.[1] ?? null;

export const pastedFiles = (clipboard: DataTransfer): File[] => {
	if (clipboard.getData("text/plain")) return [];
	return Array.from(clipboard.files ?? []);
};

const isImage = (file: File): boolean => file.type.startsWith("image/");

const merged = { tag: HISTORY_MERGE_TAG };

export const $pasteFiles = (
	editor: LexicalEditor,
	files: File[],
	inlineImages: InlineImages,
): void => {
	const images = files.filter(isImage);
	const others = files.filter((file) => !isImage(file));
	const placed = new Map<File, NodeKey>();
	const taken = new Map<File, { parentKey: NodeKey; index: number }>();
	const $createImage = (file: File, src: string): ImageNode => {
		const node = $applyNodeReplacement(
			new ImageNode(src, file.name),
		).setPreview(URL.createObjectURL(file));
		placed.set(file, node.getKey());
		return node;
	};
	const nodes = images.map((file) => $createImage(file, ""));
	if (nodes.length > 0) $insertNodes(nodes);
	const placedImage = (file: File): ImageNode | null => {
		const key = placed.get(file);
		const node = key === undefined ? null : $getNodeByKey(key);
		return node instanceof ImageNode ? node : null;
	};
	queueMicrotask(() => {
		if (others.length > 0) inlineImages.attach(others);
		if (images.length === 0) return;
		inlineImages.attach(images, {
			stored: (file, contentId) => {
				const src = `cid:${contentId}`;
				const node = editor.read(() => placedImage(file));
				if (node) {
					editor.update(() => {
						placedImage(file)?.setSrc(src);
					}, merged);
					return;
				}
				const spot = taken.get(file);
				if (!spot) return;
				editor.update(
					() => {
						const image = $createImage(file, src);
						const parent = $getNodeByKey(spot.parentKey);
						if ($isElementNode(parent) && parent.isAttached()) {
							parent.splice(Math.min(spot.index, parent.getChildrenSize()), 0, [
								image,
							]);
							return;
						}
						$getRoot().append($createParagraphNode().append(image));
					},
					{ tag: HISTORY_PUSH_TAG },
				);
			},
			failed: (file) => {
				editor.update(() => {
					const node = placedImage(file);
					if (!node) return;
					taken.set(file, {
						parentKey: node.getParentOrThrow().getKey(),
						index: node.getIndexWithinParent(),
					});
					node.remove();
				}, merged);
			},
		});
	});
};

const isBlobUrl = (url: string): boolean => url.startsWith("blob:");

export const InlineImagePlugin = ({
	inlineImages,
}: {
	inlineImages: RefObject<InlineImages | undefined>;
}) => {
	const [editor] = useLexicalComposerContext();

	useEffect(() => {
		const owned = new Map<NodeKey, string>();
		const revoked = new Set<string>();
		const resolving = new Set<NodeKey>();
		let live = true;

		const release = (url: string): void => {
			URL.revokeObjectURL(url);
			revoked.add(url);
		};

		const adopt = (key: NodeKey, preview: string): void => {
			const previous = owned.get(key);
			if (previous === preview) return;
			if (previous) release(previous);
			owned.set(key, preview);
		};

		const resolve = (key: NodeKey, src: string, contentId: string): void => {
			const images = inlineImages.current;
			if (!images?.owns(contentId) || resolving.has(key)) return;
			resolving.add(key);
			void images.resolve(contentId).then((url) => {
				resolving.delete(key);
				if (url === null) return;
				if (!live) {
					URL.revokeObjectURL(url);
					return;
				}
				editor.update(() => {
					const node = $getNodeByKey(key);
					if (!(node instanceof ImageNode) || node.getSrc() !== src) {
						URL.revokeObjectURL(url);
						return;
					}
					node.setPreview(url);
				}, merged);
			});
		};

		const visit = (key: NodeKey, orphans: NodeKey[]): void => {
			const node = $getNodeByKey(key);
			if (!(node instanceof ImageNode)) return;
			const referenced = contentIdOf(node.getSrc());
			if (referenced !== null && !inlineImages.current?.owns(referenced)) {
				orphans.push(key);
				return;
			}
			const preview = node.getPreview();
			if (preview && !revoked.has(preview)) {
				if (isBlobUrl(preview)) adopt(key, preview);
				return;
			}
			const src = node.getSrc();
			const contentId = contentIdOf(src);
			if (contentId !== null) resolve(key, src, contentId);
		};

		const removeReferences = (contentId: string): void => {
			editor.update(() => {
				for (const { node } of $dfs()) {
					if (node instanceof ImageNode && node.getSrc() === `cid:${contentId}`)
						node.remove();
				}
			}, merged);
		};

		const unsubscribe =
			inlineImages.current?.onRemoved(removeReferences) ?? (() => {});

		const unregister = editor.registerMutationListener(
			ImageNode,
			(mutations) => {
				const orphans: NodeKey[] = [];
				editor.read(() => {
					for (const [key, mutation] of mutations) {
						if (mutation !== "destroyed") {
							visit(key, orphans);
							continue;
						}
						const url = owned.get(key);
						owned.delete(key);
						if (url) release(url);
					}
				});
				if (orphans.length === 0) return;
				editor.update(() => {
					for (const key of orphans) $getNodeByKey(key)?.remove();
				}, merged);
			},
		);

		return () => {
			live = false;
			mergeRegister(unregister, unsubscribe)();
			for (const url of owned.values()) URL.revokeObjectURL(url);
			owned.clear();
		};
	}, [editor, inlineImages]);

	return null;
};
