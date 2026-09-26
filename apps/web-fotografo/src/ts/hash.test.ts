import { describe, expect, test } from "vitest";
import { sha256EmFatias } from "./hash";

describe("sha256EmFatias", () => {
    test("dá o SHA-256 conhecido, mesmo lendo em fatias menores que o arquivo", async () => {
        const abc = new Blob([new TextEncoder().encode("abc")]);
        expect(await sha256EmFatias(abc, 1)).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    });
});
