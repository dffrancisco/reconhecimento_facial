import { test, describe } from "node:test";
import assert from "node:assert";
import { ipDoPedido } from "./limiteTaxa";

describe("ipDoPedido", () => {
    test("usa CF-Connecting-IP quando a Cloudflare é confiável", () => {
        assert.strictEqual(ipDoPedido({ "cf-connecting-ip": "203.0.113.7" }, "10.0.0.1", true), "203.0.113.7");
    });

    test("ignora CF-Connecting-IP quando a Cloudflare não é confiável", () => {
        // Sem isso, qualquer um manda o cabeçalho e fura o limite de buscas.
        assert.strictEqual(ipDoPedido({ "cf-connecting-ip": "203.0.113.7" }, "10.0.0.1", false), "10.0.0.1");
    });

    test("cai no IP do socket quando o cabeçalho não veio", () => {
        assert.strictEqual(ipDoPedido({}, "10.0.0.1", true), "10.0.0.1");
    });

    test("sem IP nenhum devolve desconhecido, em vez de vazio", () => {
        // Chave vazia no Redis juntaria pedidos de origens diferentes no mesmo balde.
        assert.strictEqual(ipDoPedido({}, undefined, true), "desconhecido");
    });

    test("cabeçalho repetido (array) usa o primeiro valor", () => {
        assert.strictEqual(ipDoPedido({ "cf-connecting-ip": ["203.0.113.7", "1.2.3.4"] }, "10.0.0.1", true), "203.0.113.7");
    });
});
