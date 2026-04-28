export type AccountFanoutEvent = {
	type: "AccountDelete";
	accountConfigId: string;
};

export type AccountFinalizeEvent = {
	type: "FinalizeAccountDelete";
	accountConfigId: string;
};
