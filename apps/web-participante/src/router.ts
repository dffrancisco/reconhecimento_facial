import { createRouter, createWebHashHistory } from "vue-router";

// Rotas declaradas à mão: são sete e fixas. A convenção de pastas (pages/<tela>/) continua.
export const router = createRouter({
    history: createWebHashHistory(),
    routes: [
        { path: "/e/:slug", name: "evento", component: () => import("./pages/evento/index.vue") },
        { path: "/p/:chave", name: "eventoPrivado", component: () => import("./pages/evento/index.vue") },
        { path: "/r/:token", name: "resultado", component: () => import("./pages/resultado/index.vue") },
        { path: "/a/:chave", name: "anfitriao", component: () => import("./pages/anfitriao/index.vue") },
        { path: "/privacidade", name: "privacidade", component: () => import("./pages/privacidade/index.vue") },
        { path: "/:qualquer(.*)*", redirect: "/privacidade" },
    ],
});
