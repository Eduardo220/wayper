import { registerRootComponent } from 'expo';
import 'react-native-gesture-handler';
import { AppRegistry } from 'react-native';
import App from './App';
import runNotificationActionTask from './src/services/run/runNotificationActionTask.js';


// registerRootComponent calls AppRegistry.registerComponent('main', () => App);
// It also ensures that whether you load the app in Expo Go or in a native build,
// the environment is set up appropriately
AppRegistry.registerHeadlessTask('WayperRunNotificationAction', () => runNotificationActionTask);
registerRootComponent(App);
