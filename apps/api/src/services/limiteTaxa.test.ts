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

test("atrás do proxy, usa o primeiro IP do X-Forwarded-For quando não há cabeçalho da Cloudflare", () => {
    // Sem isso o IP seria o do Traefik e o limite valeria para a plataforma inteira.
    assert.strictEqual(ipDoPedido({ "x-forwarded-for": "203.0.113.9, 10.0.0.5" }, "172.18.0.2", true), "203.0.113.9");
});

test("X-Forwarded-For é ignorado quando não se confia no proxy", () => {
    assert.strictEqual(ipDoPedido({ "x-forwarded-for": "203.0.113.9" }, "172.18.0.2", false), "172.18.0.2");
});

test("o cabeçalho da Cloudflare tem precedência sobre o X-Forwarded-For", () => {
    assert.strictEqual(
        ipDoPedido({ "cf-connecting-ip": "203.0.113.7", "x-forwarded-for": "1.2.3.4" }, "172.18.0.2", true),
        "203.0.113.7"
    );
});
