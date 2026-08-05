/**
 * babel-preset-expo, and nothing else — the preset already handles TypeScript,
 * JSX and the React Native runtime for everything Metro bundles, including the
 * @loro/core sources it reads straight from packages/core/src.
 *
 * WHY babel-preset-expo IS AN EXPLICIT devDependency, even though `expo`
 * already depends on it. Babel resolves a preset named as a bare string from
 * the directory of THIS file, i.e. apps/mobile/node_modules. npm chose to nest
 * expo's copy at node_modules/expo/node_modules/babel-preset-expo instead of
 * hoisting it (no version conflict — it just did), which Babel's lookup from
 * here never reaches. The result was:
 *
 *   iOS Bundling failed 7ms index.js (1 module)
 *   TypeError: Cannot read properties of undefined (reading 'transformFile')
 *
 * which names neither Babel nor the preset, because metro/src/Bundler.js
 * swallows the real "Cannot find module 'babel-preset-expo'" into a
 * `transformer_load_failed` reporter event and leaves `_transformer` undefined
 * for every later call. Declaring the preset here hoists it and pins it to the
 * same ~57.0.5 range expo asks for, so there is exactly one copy.
 *
 * Do not remove it on the grounds that expo already provides it — the lockfile
 * records the nested path, so `npm ci` reproduces the nesting on EAS too.
 *
 * NOT ADDED YET, on purpose: @babel/plugin-syntax-import-attributes.
 * packages/core/src/catalog/{staticVideos,embedVideos}.ts import their JSON with
 * `with { type: 'json' }`, which exists so those modules load under
 * `node --test`. Babel 7.29 (what Metro 0.83 ships) parses that syntax by
 * default — measured directly — so the plugin is very likely unnecessary. But
 * checkpoint A imports no JSON at all, so nothing here exercises it. If
 * checkpoint B (@loro/core/catalog) fails on that import, this file is the first
 * place to look and the plugin is the first thing to try.
 */
module.exports = function (api) {
  api.cache(true);
  return {
    presets: ['babel-preset-expo'],
  };
};
