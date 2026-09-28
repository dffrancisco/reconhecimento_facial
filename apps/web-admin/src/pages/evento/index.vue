<script setup lang="ts">
import { nextTick } from "vue";
import { useRoute } from "vue-router";
import Cabecalho from "../../componentes/Cabecalho.vue";
import { periodo } from "../../ts/datas";
import Dados from "./components/Dados.vue";
import Links from "./components/Links.vue";
import { actions, state } from "./evento";

const rota = useRoute();
nextTick(() => actions.init(Number(rota.params.id)));
</script>

<template>
    <main class="pagina">
        <Cabecalho />
        <div class="mx-auto max-w-4xl p-4">
            <p v-if="state.carregando" class="apagado">Carregando…</p>
            <div v-else-if="state.erro" class="superficie p-6 text-center">
                <p class="text-base font-extrabold">{{ state.erro }}</p>
                <RouterLink to="/" class="botao-secundario mt-3 inline-block" data-acao="voltar">Voltar aos eventos</RouterLink>
            </div>
            <template v-else-if="state.evento">
                <h1 class="text-lg font-extrabold">{{ state.evento.nome }}</h1>
                <p class="apagado">
                    {{ periodo(state.evento.data_inicio, state.evento.data_fim) }} · {{ state.evento.privado === "S" ? "Privado" : "Público" }} ·
                    {{ state.evento.ativo === "S" ? "Ativo" : "Inativo" }}
                </p>
                <Dados />
                <Links />
            </template>
        </div>
    </main>
</template>
