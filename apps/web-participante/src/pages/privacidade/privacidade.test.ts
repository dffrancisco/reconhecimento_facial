import { describe, expect, test } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { createRouter, createWebHashHistory } from "vue-router";
import Privacidade from "./index.vue";

function roteador() {
    return createRouter({
        history: createWebHashHistory(),
        routes: [
            { path: "/e/:slug", component: { template: "<p>camera</p>" } },
            { path: "/privacidade", component: Privacidade },
        ],
    });
}

describe("tela de privacidade", () => {
    test("vindo do link Termo, Voltar desfaz a navegação", async () => {
        const router = roteador();
        await router.push("/e/corrida");
        await router.push("/privacidade");
        const tela = mount(Privacidade, { global: { plugins: [router] } });

        await tela.get("button").trigger("click");
        await new Promise((r) => window.addEventListener("popstate", r, { once: true }));
        await flushPromises();

        expect(router.currentRoute.value.path).toBe("/e/corrida");
    });

    test("aberta direto, não oferece Voltar para lugar nenhum", async () => {
        window.history.replaceState(null, "", "/");
        const router = roteador();
        await router.push("/privacidade");
        await flushPromises();
        const tela = mount(Privacidade, { global: { plugins: [router] } });

        expect(tela.text()).not.toContain("Voltar");
    });
});
