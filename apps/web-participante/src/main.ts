import { createApp } from "vue";
import App from "./App.vue";
import { router } from "./router";
// Só o display usa a Bricolage; o corpo continua system-ui, que carrega instantâneo.
// O arquivo com o eixo de largura (78 KB, com swap) é o que permite o nome do evento
// estreito como número de peito.
import "@fontsource-variable/bricolage-grotesque/wdth.css";
import "./estilo.css";

createApp(App).use(router).mount("#app");
