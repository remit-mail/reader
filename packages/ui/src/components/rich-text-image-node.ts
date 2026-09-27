import {
	$applyNodeReplacement,
	$getDocument,
	addClassNamesToElement,
	DecoratorNode,
	type DOMConversionOutput,
	type DOMExportOutput,
	type EditorConfig,
	type LexicalUpdateJSON,
	type NodeKey,
	type SerializedLexicalNode,
	type Spread,
} from "lexical";

type SerializedImageNode = Spread<
	{ src: string; alt: string },
	SerializedLexicalNode
>;

/**
 * Lexical ships no image node, so a pasted `<img>` mapped to nothing and the
 * picture vanished between the clipboard and the message (#684). It carries
 * `src` and `alt` and nothing else — the two attributes the paste profile
 * admits — and renders as the image itself rather than as a placeholder, so
 * what the composer shows is what the recipient gets.
 */
export class ImageNode extends DecoratorNode<null> {
	/** @internal */
	__src: string;
	/** @internal */
	__alt: string;
	/** @internal */
	__preview = "";

	$config() {
		return this.config("image", {
			importDOM: {
				img: () => ({ conversion: $convertImageElement, priority: 0 }),
			},
		});
	}

	constructor(src = "", alt = "", key?: NodeKey) {
		super(key);
		this.__src = src;
		this.__alt = alt;
	}

	afterCloneFrom(prevNode: this): void {
		super.afterCloneFrom(prevNode);
		this.__src = prevNode.__src;
		this.__alt = prevNode.__alt;
		this.__preview = prevNode.__preview;
	}

	createDOM(config: EditorConfig): HTMLImageElement {
		const element = this.buildImage(this.__preview || this.__src);
		addClassNamesToElement(element, config.theme.image);
		return element;
	}

	updateDOM(prevNode: this, element: HTMLImageElement): boolean {
		const shown = this.__preview || this.__src;
		if ((prevNode.__preview || prevNode.__src) !== shown)
			element.setAttribute("src", shown);
		if (prevNode.__alt !== this.__alt) element.setAttribute("alt", this.__alt);
		return false;
	}

	exportDOM(): DOMExportOutput {
		return { element: this.buildImage(this.__src) };
	}

	exportJSON(): SerializedImageNode {
		return { ...super.exportJSON(), alt: this.getAlt(), src: this.getSrc() };
	}

	updateFromJSON(serializedNode: LexicalUpdateJSON<SerializedImageNode>): this {
		return super
			.updateFromJSON(serializedNode)
			.setSrc(serializedNode.src)
			.setAlt(serializedNode.alt);
	}

	getSrc(): string {
		return this.getLatest().__src;
	}

	setSrc(src: string): this {
		const writable = this.getWritable();
		writable.__src = src;
		return writable;
	}

	getPreview(): string {
		return this.getLatest().__preview;
	}

	setPreview(preview: string): this {
		const writable = this.getWritable();
		writable.__preview = preview;
		return writable;
	}

	getAlt(): string {
		return this.getLatest().__alt;
	}

	setAlt(alt: string): this {
		const writable = this.getWritable();
		writable.__alt = alt;
		return writable;
	}

	/** The text alternative is what a plain-text reader is left with. */
	getTextContent(): string {
		return this.getAlt();
	}

	isInline(): true {
		return true;
	}

	private buildImage(src: string): HTMLImageElement {
		const element = $getDocument().createElement("img");
		element.setAttribute("src", src);
		element.setAttribute("alt", this.__alt);
		return element;
	}
}

const $convertImageElement = (element: HTMLElement): DOMConversionOutput => ({
	node: $applyNodeReplacement(
		new ImageNode(
			element.getAttribute("src") ?? "",
			element.getAttribute("alt") ?? "",
		),
	),
});
