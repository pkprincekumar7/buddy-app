module.exports = {
  presets: ['babel-preset-expo', 'nativewind/babel'],
  plugins: [
    [
      'module-resolver',
      {
        root: ['./src'],
        alias: { '@': './src' },
        extensions: ['.ts', '.tsx', '.js', '.jsx', '.json'],
      },
    ],
    // must be last — already includes react-native-worklets/plugin internally
    'react-native-reanimated/plugin',
  ],
};
