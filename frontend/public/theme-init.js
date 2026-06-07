// Key must match THEME_KEY in src/lib/theme.ts — update both if renamed.
(function () {
  try {
    var stored = localStorage.getItem('buddy360_theme');
    var prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    var isLight = stored === 'light' || (stored === null && !prefersDark);
    if (isLight) document.documentElement.classList.add('light');
  } catch (e) {}
})();
