<script setup lang="ts">
import { nextTick } from "vue";
import { useRoute } from "vue-router";
import BotaoPilula from "../../componentes/BotaoPilula.vue";
import FotoAberta from "../../componentes/FotoAberta.vue";
import GradeFotos from "../../componentes/GradeFotos.vue";
import { actions, state } from "./anfitriao";

const rota = useRoute();
nextTick(() => actions.init(String(rota.params.chave ?? "")));
</script>

<template>
    <main class="tela-largada px-5 py-7">
        <p class="rotulo">Galeria do evento</p>
        <h1 class="titulo mt-1">{{ state.evento || "Abrindo…" }}</h1>
        <p v-if="state.fotos.length > 0" class="mt-1 text-[11px] text-white/75">{{ state.fotos.length }} fotos</p>

        <p v-if="state.mensagem && state.fotos.length === 0" class="titulo mt-8">{{ state.mensagem }}</p>

        <template v-else>
            <div v-if="state.zip === 'pronto'" class="mt-4 flex flex-col gap-2">
                <a v-for="(url, indice) in state.urlsZip" :key="url" :href="url" class="pilula block text-center">
                    {{ state.urlsZip.length === 1 ? "Baixar o ZIP" : `Baixar parte ${indice + 1} de ${state.urlsZip.length}` }}
                </a>
            </div>
            <BotaoPilula
                v-else-if="state.fotos.length > 0"
                class="mt-4"
                variante="secundaria"
                :desabilitado="state.zip === 'montando'"
                @click="actions.pedirZip()"
            >
                {{ state.zip === "montando" ? "Preparando o ZIP…" : "Baixar tudo" }}
            </BotaoPilula>

            <p v-if="state.mensagem" class="mt-3 text-center text-xs text-white/85">{{ state.mensagem }}</p>

            <GradeFotos class="mt-4" :fotos="state.fotos" @abrir="actions.abrir" />

            <BotaoPilula v-if="!state.acabou" class="mt-4" :desabilitado="state.carregando" @click="actions.carregarMais()">
                {{ state.carregando ? "Carregando…" : "Ver mais fotos" }}
            </BotaoPilula>
        </template>

        <FotoAberta
            v-if="actions.fotoAberta()"
            :foto="actions.fotoAberta()!"
            :pode-compartilhar="false"
            @fechar="actions.fechar()"
            @salvar="actions.salvar()"
            @proxima="actions.proxima()"
            @anterior="actions.anterior()"
        />
    </main>
</template>
