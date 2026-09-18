import "./loadEnv";
import { iniciarConfig } from "./services/config";
import StartApp from "./services/server";

try {
    iniciarConfig(process.env);
} catch (erro) {
    console.error((erro as Error).message);
    process.exit(1);
}

new StartApp().listen();
