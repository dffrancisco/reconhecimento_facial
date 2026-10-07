<script setup lang="ts">
import { computed, nextTick, ref } from "vue";
import { useRoute } from "vue-router";
import BotaoPilula from "../../componentes/BotaoPilula.vue";
import FaixaPatrocinadores from "../../componentes/FaixaPatrocinadores.vue";
import { periodoParaTela } from "../../ts/dias";
import { actions, state } from "./home";

const rota = useRoute();
nextTick(() => actions.init(String(rota.params.slug ?? ""), String(rota.params.chave ?? "")));

const periodo = computed(() => (state.evento ? periodoParaTela(state.evento.data_inicio, state.evento.data_fim) : ""));
// A capa entra quando chega: até lá a home é só o degradê, que já é a cara do evento.
const capaCarregada = ref(false);
</script>

<template>
    <main class="tela-largada relative isolate flex flex-col overflow-hidden px-6 py-8 lg:justify-center lg:px-16">
        <template v-if="state.evento?.capa">
            <img
                data-capa
                :src="state.evento.capa"
                alt=""
                class="capa-evento"
                :data-carregada="capaCarregada || undefined"
                @load="capaCarregada = true"
            />
            <div class="veu-largada" aria-hidden="true"></div>
        </template>

        <p v-if="state.carregando" class="titulo">Abrindo o evento…</p>

        <section v-else-if="state.mensagem" class="flex flex-1 flex-col justify-center">
            <h1 class="titulo">{{ state.mensagem }}</h1>
            <router-link to="/privacidade" class="mt-4 text-xs underline">Dúvidas sobre seus dados</router-link>
        </section>

        <template v-else-if="state.evento">
            <!-- O nome grande é o elemento memorável: um número de peito, não um cartaz.
                 No celular os botões descem para perto do polegar; no computador ficam logo
                 abaixo do nome, que é para onde o olho já está olhando. -->
            <section class="flex flex-1 flex-col justify-center lg:flex-none">
                <p class="rotulo">Suas fotos do evento</p>
                <h1 class="display mt-3">{{ state.evento.nome }}</h1>
                <p class="mt-4 text-sm text-white/90">
                    {{ periodo }}<template v-if="state.evento.total_fotos > 0"> · {{ state.evento.total_fotos.toLocaleString("pt-BR") }} fotos</template>
                </p>
            </section>

            <section class="flex flex-col gap-2 pb-2 lg:mt-10 lg:max-w-sm">
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
