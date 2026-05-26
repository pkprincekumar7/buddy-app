// Handles ?clear_access_token=true for explicit logout redirect flows.
// Tokens live in HttpOnly cookies (server-clears on logout); this just strips the param from the URL.
export function initAppParams(): void {
  if (typeof window === 'undefined') return;
  const urlParams = new URLSearchParams(window.location.search);
  if (urlParams.get('clear_access_token') === 'true') {
    urlParams.delete('clear_access_token');
    const newUrl =
      window.location.pathname +
      (urlParams.toString() ? `?${urlParams.toString()}` : '') +
      window.location.hash;
    window.history.replaceState({}, document.title, newUrl);
  }
}
