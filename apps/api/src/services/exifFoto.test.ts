import { test, describe } from "node:test";
import assert from "node:assert";
import { combinarDataExif } from "./exifFoto";

describe("combinarDataExif", () => {
    test("sem data original devolve null", () => {
        assert.strictEqual(combinarDataExif(undefined, undefined, "America/Sao_Paulo"), null);
    });

    test("usa o offset do EXIF quando presente", () => {
        // 10:00 local com offset -03:00 -> 13:00 UTC.
        const dataOriginal = new Date(2026, 10, 1, 10, 0, 0);
        const resultado = combinarDataExif(dataOriginal, "-03:00", "America/Sao_Paulo");
        assert.strictEqual(resultado?.toISOString(), "2026-11-01T13:00:00.000Z");
    });

    test("usa o fuso do evento quando falta o offset", () => {
        const dataOriginal = new Date(2026, 10, 1, 10, 0, 0);
        const resultado = combinarDataExif(dataOriginal, undefined, "America/Sao_Paulo");
        assert.strictEqual(resultado?.toISOString(), "2026-11-01T13:00:00.000Z");
    });

    test("offset positivo", () => {
        const dataOriginal = new Date(2026, 5, 15, 8, 30, 0);
        const resultado = combinarDataExif(dataOriginal, "+02:00", "America/Sao_Paulo");
        assert.strictEqual(resultado?.toISOString(), "2026-06-15T06:30:00.000Z");
    });
});
