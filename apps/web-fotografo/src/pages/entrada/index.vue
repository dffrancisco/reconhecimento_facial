<script setup lang="ts">
import { nextTick } from "vue";
import { useRoute, useRouter } from "vue-router";
import { guardarToken, lerToken } from "../../ts/token";

// Usa o router injetado (e não o módulo global) para a tela funcionar no teste montado.
const rota = useRoute();
const roteador = useRouter();
let invalido = false;

nextTick(() => {
    const doLink = typeof rota.query.t === "string" && rota.query.t ? rota.query.t : null;
    const token = doLink ?? lerToken();
    if (!token) return;
    guardarToken(token);
    roteador.replace("/enviar");
});

invalido = !(typeof rota.query.t === "string" && rota.query.t) && !lerToken();
</script>

<template>
    <main class="pagina flex items-center justify-center p-6">
        <div v-if="invalido" class="superficie max-w-md p-6 text-center">
            <span class="selo"></span>
            <p class="mt-3 text-base font-extrabold">Este link de envio não é válido. Peça o link ao operador da estação.</p>
        </div>
    </main>
</template>
