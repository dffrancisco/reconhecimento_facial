import { test } from "node:test";
import assert from "node:assert";
import { criarSemaforo } from "./semaforo";

test("não deixa passar mais tarefas que o limite ao mesmo tempo", async () => {
    const semaforo = criarSemaforo(2);
    let simultaneas = 0;
    let pico = 0;

    const tarefa = async () => {
        await semaforo(async () => {
            simultaneas++;
            pico = Math.max(pico, simultaneas);
            await new Promise((resolve) => setTimeout(resolve, 20));
            simultaneas--;
        });
    };

    await Promise.all([tarefa(), tarefa(), tarefa(), tarefa(), tarefa()]);
    assert.strictEqual(pico, 2);
    assert.strictEqual(simultaneas, 0);
});

test("libera a vaga mesmo quando a tarefa falha", async () => {
    const semaforo = criarSemaforo(1);
    await assert.rejects(() => semaforo(async () => { throw new Error("falhou"); }));
    assert.strictEqual(await semaforo(async () => "passou"), "passou");
});
