import { ForbiddenError } from "@remit/data-ports/errors";
import type { HandlerContext } from "../types.js";

export const requireOperator = (ctx: HandlerContext): void => {
	if (!ctx.operator) throw new ForbiddenError("Operator access required.");
};
