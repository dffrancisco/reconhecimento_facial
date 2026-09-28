<script setup lang="ts">
import { watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { sessao } from "./ts/sessao";

const rota = useRoute();
const roteador = useRouter();

// A sessão que some no meio de uma tela (expirou numa chamada) leva de volta à entrada.
watch(sessao, (atual) => {
    if (!atual && rota.name !== "entrar") roteador.replace({ name: "entrar" });
});
</script>

<template>
    <router-view />
</template>
