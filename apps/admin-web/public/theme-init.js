/*
 * Applies the person's theme before the first paint, so a forced Light or Dark page never flashes
 * the other one. Loaded synchronously from index.html as its own file: the Content-Security-Policy
 * allows only same-origin scripts (script-src 'self'), never inline ones.
 * Keep in step with src/core/theme/theme.ts (THEME_KEY and the values).
 */
(function () {
  try {
    var choice = window.localStorage.getItem('jawwid.theme')
    if (choice === 'light' || choice === 'dark') document.documentElement.setAttribute('data-theme', choice)
  } catch (e) {
    /* Storage blocked: Auto (the operating system's setting) stands. */
  }
})()
