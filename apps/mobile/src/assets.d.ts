/**
 * Image imports.
 *
 * Metro resolves `import logo from './logo.png'` to a number: the id the asset
 * registry hands to <Image source={…}>, which is what RN's ImageRequireSource
 * is. TypeScript has no idea about that on its own — expo/tsconfig.base does
 * not declare asset modules, and neither does react-native's own types — so
 * without this every image import is a "cannot find module" error.
 *
 * Declared here rather than reached for with require() because require() is
 * untyped in this project (no @types/node) and would hand every asset back as
 * `any`.
 */
declare module '*.png' {
  const source: number;
  export default source;
}

declare module '*.webp' {
  const source: number;
  export default source;
}
