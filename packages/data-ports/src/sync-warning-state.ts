import { SyncWarningStage, SyncWarningState } from "@remit/domain-enums";

export const SYNC_WARNING_SURFACE_ATTEMPTS = 3;

export const syncWarningState = (
	stage: (typeof SyncWarningStage)[keyof typeof SyncWarningStage],
	attempts: number,
): (typeof SyncWarningState)[keyof typeof SyncWarningState] =>
	stage === SyncWarningStage.Body && attempts >= SYNC_WARNING_SURFACE_ATTEMPTS
		? SyncWarningState.GaveUp
		: SyncWarningState.Retrying;
