/**
 * Whether a keyboard layer above the rows owns the cursor keys over them.
 *
 * A list body nested under such a layer stands its own roving-focus group down:
 * the group reads only `event.key`, so it takes Shift+↑/↓ as plain arrows and
 * stops them, and the layer above — which extends a range with exactly those —
 * never sees the press. Standing down also leaves one cursor: the layer's, drawn
 * where the layer says, rather than a focus ring walking on its own.
 *
 * It travels as context rather than a prop because the layer and the rows have
 * components between them that own neither — the pane, the filter sheet, the
 * sections — and every one of them would otherwise have to thread it through.
 */
import { createContext, useContext } from "react";

const ListKeyboardAboveContext = createContext(false);

/** Declares that this subtree's list rows answer to a keyboard layer above. */
export const ListKeyboardAbove = ListKeyboardAboveContext.Provider;

/** Whether a keyboard layer above these rows owns their cursor keys. */
export function useListKeyboardAbove(): boolean {
	return useContext(ListKeyboardAboveContext);
}
