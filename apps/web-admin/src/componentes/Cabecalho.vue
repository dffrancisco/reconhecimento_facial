<script setup lang="ts">
import { useRouter } from "vue-router";
import { sair, sessao } from "../ts/sessao";

const roteador = useRouter();

function sairAgora(): void {
    sair();
    roteador.replace({ name: "entrar" });
}
</script>

<template>
    <header class="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--borda)] bg-white px-4 py-2.5">
        <div class="flex items-center gap-4">
            <span><span class="selo mr-2"></span><b>Admin</b></span>
            <RouterLink to="/" class="apagado hover:underline">Eventos</RouterLink>
        </div>
        <span v-if="sessao" class="apagado">
            {{ sessao.nome }} · <button type="button" class="underline" data-acao="sair" @click="sairAgora">Sair</button>
        </span>
    </header>
</template>
