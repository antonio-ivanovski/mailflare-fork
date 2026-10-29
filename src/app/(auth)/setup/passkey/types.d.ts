export type PasskeySetupOptionsResponse = {
	options?: unknown;
	ceremonyToken?: string;
	email?: string;
	error?: string;
};

export type PasskeySetupResult = {
	ok?: boolean;
	redirect?: string;
	recoveryCodes?: string[];
	error?: string;
};
