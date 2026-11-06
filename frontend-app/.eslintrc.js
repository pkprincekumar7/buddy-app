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
};
