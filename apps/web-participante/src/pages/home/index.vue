<script setup lang="ts">
import { computed, nextTick } from "vue";
import { useRoute } from "vue-router";
import BotaoPilula from "../../componentes/BotaoPilula.vue";
import FaixaPatrocinadores from "../../componentes/FaixaPatrocinadores.vue";
import { periodoParaTela } from "../../ts/dias";
import { actions, state } from "./home";

const rota = useRoute();
nextTick(() => actions.init(String(rota.params.slug ?? ""), String(rota.params.chave ?? "")));

const periodo = computed(() => (state.evento ? periodoParaTela(state.evento.data_inicio, state.evento.data_fim) : ""));
</script>

<template>
    <main class="tela-largada flex flex-col px-6 py-8">
        <p v-if="state.carregando" class="titulo">Abrindo o evento…</p>

        <section v-else-if="state.mensagem" class="flex flex-1 flex-col justify-center">
            <h1 class="titulo">{{ state.mensagem }}</h1>
            <router-link to="/privacidade" class="mt-4 text-xs underline">Dúvidas sobre seus dados</router-link>
        </section>

        <template v-else-if="state.evento">
            <!-- O nome grande é o elemento memorável: um número de peito, não um cartaz. -->
            <section class="flex flex-1 flex-col justify-center">
                <p class="rotulo">Suas fotos do evento</p>
                <h1 class="display mt-2">{{ state.evento.nome }}</h1>
                <p class="mt-3 text-sm text-white/85">
                    {{ periodo }}<template v-if="state.evento.total_fotos > 0"> · {{ state.evento.total_fotos.toLocaleString("pt-BR") }} fotos</template>
                </p>
            </section>

            <section class="flex flex-col gap-2 pb-2">
                <BotaoPilula v-if="state.tokenLembrado" @click="actions.irParaMinhasFotos()">
                    Minhas fotos ({{ state.qtdLembrada }})
                </BotaoPilula>
                <BotaoPilula v-if="!state.tokenLembrado" @click="actions.irParaSelfie()">Buscar minhas fotos</BotaoPilula>
                <BotaoPilula v-else variante="secundaria" @click="actions.irParaSelfie()">Buscar com outra selfie</BotaoPilula>
                <BotaoPilula variante="secundaria" @click="actions.irParaGaleria()">Ver todas as fotos</BotaoPilula>
            </section>

            <FaixaPatrocinadores :patrocinadores="[]" />
        </template>
    </main>
</template>
