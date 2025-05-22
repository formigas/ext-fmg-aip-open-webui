import type { LayoutServerLoad } from './$types';
import { loadCustomThemesFromEnv } from '$lib/server/custom-theme-loader';

export const load: LayoutServerLoad = async () => {
	const themes = loadCustomThemesFromEnv();

	return {
		customThemes: themes ?? {}
	};
};
