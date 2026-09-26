import { createRouter, createWebHashHistory } from "vue-router";

export const router = createRouter({
    history: createWebHashHistory(),
    routes: [
        { path: "/", name: "entrada", component: () => import("./pages/entrada/index.vue") },
        { path: "/enviar", name: "enviar", component: () => import("./pages/enviar/index.vue") },
        { path: "/estacao", name: "estacao", component: () => import("./pages/estacao/index.vue") },
        { path: "/:qualquer(.*)*", redirect: "/" },
    ],
});
