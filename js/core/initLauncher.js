// core/initLauncher.js
import "../config/appConfig.js";
import { init } from "../logic/mainController.js";

// Launch the app only after logging levels are configured
init();
