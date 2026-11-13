/**
 * React Native application entry point.
 */
import {AppRegistry} from 'react-native';
import App, {registerBackgroundCommandHandler} from './src/App';
import {name as appName} from './app.json';

// FCM background commands must be handled at module scope so the headless JS
// runtime (Android) / background execution window (iOS) can process and ack
// them while the app is closed.
registerBackgroundCommandHandler();

AppRegistry.registerComponent(appName, () => App);
