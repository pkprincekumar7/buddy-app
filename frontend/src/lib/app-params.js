// Handles ?clear_access_token=true for explicit logout redirect flows.
// Tokens live in HttpOnly cookies (server-clears on logout); this just strips the param from the URL.
// Runs once at app startup via side-effect import in main.jsx.

if (typeof window !== 'undefined') {
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
