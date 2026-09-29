import { createApp } from "vue";
import App from "./App.vue";
import { router } from "./router";
// Só o display usa a Bricolage; o corpo continua system-ui, que carrega instantâneo.
import "@fontsource-variable/bricolage-grotesque";
import "./estilo.css";

createApp(App).use(router).mount("#app");
