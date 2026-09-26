import { beforeEach, describe, expect, test } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { createRouter, createWebHashHistory } from "vue-router";
import Entrada from "./index.vue";

function roteador() {
    return createRouter({
        history: createWebHashHistory(),
        routes: [
            { path: "/", component: Entrada },
            { path: "/enviar", component: { template: "<p>envio</p>" } },
        ],
    });
}

describe("entrada pelo link do fotógrafo", () => {
    beforeEach(() => localStorage.clear());

    test("o link com ?t= guarda o token e abre o envio", async () => {
        const router = roteador();
        await router.push("/?t=token-da-ana");
        mount(Entrada, { global: { plugins: [router] } });
        await flushPromises();

        expect(localStorage.getItem("token_upload")).toBe("token-da-ana");
        expect(router.currentRoute.value.path).toBe("/enviar");
    });

    test("sem token no link e nenhum salvo, explica o que fazer", async () => {
        const router = roteador();
        await router.push("/");
        const tela = mount(Entrada, { global: { plugins: [router] } });
        await flushPromises();

        expect(tela.text()).toContain("Este link de envio não é válido. Peça o link ao operador da estação.");
        expect(router.currentRoute.value.path).toBe("/");
    });

    test("reaberto sem ?t= mas com o token de antes, volta direto para o envio", async () => {
        localStorage.setItem("token_upload", "token-salvo");
        const router = roteador();
        await router.push("/");
        mount(Entrada, { global: { plugins: [router] } });
        await flushPromises();

        expect(router.currentRoute.value.path).toBe("/enviar");
    });
});
