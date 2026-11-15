module.exports = {
  root: true,
  extends: '@react-native',
  ignorePatterns: ['src/theme/tokens.generated.js', 'src/api/generated/'],
  rules: {
    '@typescript-eslint/no-unused-vars': [
      'error',
      {
        argsIgnorePattern: '^_',
        varsIgnorePattern: '^_',
        destructuredArrayIgnorePattern: '^_',
      },
    ],
    // `void promise` marks an intentionally un-awaited promise — the same
    // convention the web app uses (and the code copied from it verbatim).
    'no-void': 'off',
    // Theme-token-driven styles (gradients, glows, rgb()/css() colors) are
    // passed inline by design — see CLAUDE.md "Theme & colors".
    'react-native/no-inline-styles': 'off',
  },
  overrides: [
    {
      // The kids page takes every colour and font from the theme
      // (docs/child-view-build-plan.md "Theming"): no literals.
      files: ['src/components/kids/**/*.{ts,tsx}', 'src/screens/KidsMode.tsx'],
      rules: {
        'no-restricted-syntax': [
          'error',
          {
            selector:
              'Literal[value=/#[0-9a-fA-F]{3,8}\\b|\\b(rgba?|hsla?)\\(\\s*[\\d.]/]',
            message:
              'Use a theme token (bg-kids-*, rgb() from @/theme), not a colour literal.',
          },
          {
            selector:
              'TemplateElement[value.raw=/#[0-9a-fA-F]{3,8}\\b|\\b(rgba?|hsla?)\\(\\s*[\\d.]/]',
            message:
              'Use a theme token (bg-kids-*, rgb() from @/theme), not a colour literal.',
          },
          {
            selector: "Property[key.name='fontFamily']",
            message:
              'Use font-orbitron / font-rajdhani classes or font() from @/theme.',
          },
          {
            selector: "Property[key.name='fontWeight']",
            message:
              'Use the per-weight font classes; fontWeight fakes bold on Android.',
          },
        ],
      },
    },
  ],
};
