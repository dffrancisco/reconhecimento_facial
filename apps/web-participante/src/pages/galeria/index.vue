<script setup lang="ts">
import { nextTick } from "vue";
import { useRoute } from "vue-router";
import BotaoPilula from "../../componentes/BotaoPilula.vue";
import FotoAberta from "../../componentes/FotoAberta.vue";
import GradeFotos from "../../componentes/GradeFotos.vue";
import { rotuloDoDia } from "../../ts/dias";
import { actions, state } from "./galeria";

const rota = useRoute();
nextTick(() => actions.init(String(rota.params.slug ?? ""), String(rota.params.chave ?? "")));
</script>

<template>
    <main class="tela-foto px-5 py-7">
        <p class="rotulo">Todas as fotos</p>
        <h1 class="titulo titulo-tela mt-1">{{ state.nomeEvento || "Abrindo…" }}</h1>

        <div v-if="state.dias.length > 1" class="mt-3 flex flex-wrap gap-2">
            <button
                v-for="d in state.dias"
                :key="d.dia"
                type="button"
                class="chip"
                :class="{ 'chip-ativo': d.dia === state.diaAtivo }"
                @click="actions.trocarDia(d.dia)"
            >
                {{ rotuloDoDia(d.dia) }} · {{ d.qtd.toLocaleString("pt-BR") }}
            </button>
        </div>

        <p v-if="state.mensagem && state.fotos.length === 0" class="titulo mt-8">{{ state.mensagem }}</p>

        <p v-else-if="!state.carregando && state.fotos.length === 0" class="mt-8 text-sm text-white/85">
            As fotos do evento ainda estão chegando. Volte mais tarde.
        </p>

        <template v-else>
            <GradeFotos class="mt-4" :fotos="state.fotos" @abrir="actions.abrir" />

            <p v-if="state.mensagem" class="mt-3 text-center text-xs text-white/85">{{ state.mensagem }}</p>

            <BotaoPilula v-if="!state.acabou" class="mt-4" variante="secundaria" :desabilitado="state.carregando" @click="actions.carregarMais()">
                {{ state.carregando ? "Carregando…" : "Ver mais fotos" }}
            </BotaoPilula>
        </template>

        <FotoAberta
            v-if="actions.fotoAberta()"
            :foto="actions.fotoAberta()!"
            :pode-compartilhar="actions.podeCompartilhar()"
            :pronta-para-compartilhar="actions.prontaParaCompartilhar()"
            @fechar="actions.fechar()"
            @salvar="actions.salvar()"
            @compartilhar="actions.compartilhar()"
            @proxima="actions.proxima()"
            @anterior="actions.anterior()"
        />
    </main>
</template>
