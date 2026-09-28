import { createRouter, createWebHashHistory, type RouterHistory } from "vue-router";
import { sessao } from "./ts/sessao";

// Função, e não só a instância: os testes montam cada um o seu roteador em memória.
export function criarRouter(history: RouterHistory = createWebHashHistory()) {
    const router = createRouter({
        history,
        routes: [
            { path: "/entrar", name: "entrar", component: () => import("./pages/entrar/index.vue") },
            { path: "/", name: "eventos", component: () => import("./pages/eventos/index.vue") },
            { path: "/eventos/novo", name: "novo-evento", component: () => import("./pages/novo-evento/index.vue") },
            { path: "/eventos/:id(\\d+)", name: "evento", component: () => import("./pages/evento/index.vue") },
            { path: "/:qualquer(.*)*", redirect: "/" },
        ],
    });
    router.beforeEach((para) => (para.name !== "entrar" && !sessao.value ? { name: "entrar" } : true));
    return router;
}

export const router = criarRouter();
