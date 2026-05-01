/** PostCSS entry used by Vite (must use a recognizable filename — `postcss.config` has no extension and is skipped in many environments, so Tailwind never runs in prod). */
module.exports = {
  plugins: {
    tailwindcss: {},
    autoprefixer: {},
  },
};
