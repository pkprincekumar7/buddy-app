/**
 * Persist access_token from ?access_token= (URL is stripped).
 * Keeps compat with ?clear_access_token=true.
 */

const TOKEN_KEY = 'access_token';

const getAccessTokenFromUrlAndStore = () => {
	if (typeof window === 'undefined') {
		return null;
	}
	const urlParams = new URLSearchParams(window.location.search);
	const searchParam = urlParams.get(TOKEN_KEY);
	if (searchParam) {
		urlParams.delete(TOKEN_KEY);
		const newUrl = `${window.location.pathname}${urlParams.toString() ? `?${urlParams.toString()}` : ''}${window.location.hash}`;
		window.history.replaceState({}, document.title, newUrl);
		localStorage.setItem(TOKEN_KEY, searchParam);
		return searchParam;
	}
	return localStorage.getItem(TOKEN_KEY);
};

const initStoredTokenFromUrl = () => {
	const urlParams =
		typeof window === 'undefined' ? null : new URLSearchParams(window.location.search);

	if (
		urlParams &&
		urlParams.get('clear_access_token') === 'true'
	) {
		localStorage.removeItem('access_token');
		localStorage.removeItem('token');
	}

	getAccessTokenFromUrlAndStore();
};

initStoredTokenFromUrl();

export const appParams = {
	token: typeof window !== 'undefined' ? localStorage.getItem(TOKEN_KEY) : null,
};
