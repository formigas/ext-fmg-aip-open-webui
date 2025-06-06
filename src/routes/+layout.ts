// if you want to generate a static html file
// for your page.
// Documentation: https://kit.svelte.dev/docs/page-options#prerender
// export const prerender = true;

import { env } from '$env/dynamic/public';

// if you want to Generate a SPA
// you have to set ssr to false.
// This is not the case (so set as true or comment the line)
// Documentation: https://kit.svelte.dev/docs/page-options#ssr
export const ssr = false;

// How to manage the trailing slashes in the URLs
// the URL for about page will be /about with 'ignore' (default)
// the URL for about page will be /about/ with 'always'
// https://kit.svelte.dev/docs/page-options#trailingslash
export const trailingSlash = 'ignore';

export const load = async ({ fetch }) => {
	if (!env.PUBLIC_CUSTOM_THEMES_JSON_RELATIVE_TO_ROOT_PATH) {
		console.warn('Custom themes path is not set in the environment. Using empty themes.');
		return { customThemes: {} };
	}
	const res = await fetch(`/${env.PUBLIC_CUSTOM_THEMES_JSON_RELATIVE_TO_ROOT_PATH}`);
	try {
		const customThemes = await res.json();
		return { customThemes };
	} catch (error) {
		if (res.headers.get('content-type') !== 'application/json') {
			console.warn(
				`Failed to fetch custom themes. The file is not found or does not contain valid JSON. The probable cause is that the file does not exist and therefore the fallback index.html is returned.`
			);
		} else {
			console.error(error);
		}
		return { customThemes: {} };
	}
};
