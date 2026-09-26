import { describe, expect, test } from "vitest";
import { enderecoDosLinks, linkDeUpload } from "./links";

describe("links de upload", () => {
    test("monta o link com o token no formato que a entrada entende", () => {
        expect(linkDeUpload("http://192.168.0.10", "abc")).toBe("http://192.168.0.10/#/?t=abc");
    });

    test("usa o endereço da rede local configurado na estação", () => {
        expect(enderecoDosLinks("http://192.168.0.10", "http://localhost:5174")).toEqual({ endereco: "http://192.168.0.10", soNesteComputador: false });
    });

    test("sem endereço configurado e painel aberto em localhost, avisa que o link não serve no celular", () => {
        expect(enderecoDosLinks(null, "http://localhost:5174")).toEqual({ endereco: "http://localhost:5174", soNesteComputador: true });
        expect(enderecoDosLinks(null, "http://127.0.0.1")).toEqual({ endereco: "http://127.0.0.1", soNesteComputador: true });
        expect(enderecoDosLinks(null, "http://192.168.0.10")).toEqual({ endereco: "http://192.168.0.10", soNesteComputador: false });
    });
});
