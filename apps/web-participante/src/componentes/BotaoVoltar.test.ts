import { describe, expect, test } from "vitest";
import { mount } from "@vue/test-utils";
import BotaoVoltar from "./BotaoVoltar.vue";

describe("BotaoVoltar", () => {
    test("é um botão com nome para leitor de tela e avisa o toque uma vez", async () => {
        // Só a seta aparece: sem o aria-label o leitor de tela anunciaria "botão" e mais nada.
        const tela = mount(BotaoVoltar);

        await tela.get("button[aria-label='Voltar']").trigger("click");

        expect(tela.emitted("click")).toHaveLength(1);
    });
});
