const HOLD_MS = 700;

const touch = (target: HTMLElement, type: string) => {
	const { left, top } = target.getBoundingClientRect();
	target.dispatchEvent(
		new PointerEvent(type, {
			bubbles: true,
			pointerType: "touch",
			pointerId: 1,
			isPrimary: true,
			clientX: left + 20,
			clientY: top + 10,
		}),
	);
};

export const longPress = async (target: HTMLElement): Promise<void> => {
	touch(target, "pointerdown");
	await new Promise((resolve) => setTimeout(resolve, HOLD_MS));
	touch(target, "pointerup");
};
