// BEFORE App, and the order matters: ES modules evaluate in source order, so
// initPlatform + initCatalog have run by the time App's module body is
// evaluated — let alone rendered. Nothing may read core's storage or subscribe
// to it before this line has executed. (App.tsx imports it again at its own top
// so the guarantee does not depend on this file staying in this order.)
import './src/platform/boot';

import { registerRootComponent } from 'expo';

import App from './App';

// Explicit entry rather than relying on expo/AppEntry: registerRootComponent is
// the documented modern entry point and does not depend on a file inside the
// expo package that has moved between SDKs. package.json "main" points here.
registerRootComponent(App);
