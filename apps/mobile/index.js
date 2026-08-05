import { registerRootComponent } from 'expo';

import App from './App';

// Explicit entry rather than relying on expo/AppEntry: registerRootComponent is
// the documented modern entry point and does not depend on a file inside the
// expo package that has moved between SDKs. package.json "main" points here.
registerRootComponent(App);
