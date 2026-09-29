<script setup lang="ts">
import { computed, nextTick } from "vue";
import { useRoute } from "vue-router";
import BotaoPilula from "../../componentes/BotaoPilula.vue";
import FaixaPatrocinadores from "../../componentes/FaixaPatrocinadores.vue";
import FotoAberta from "../../componentes/FotoAberta.vue";
import GradeFotos from "../../componentes/GradeFotos.vue";
import { actions, state, validadeParaTela } from "./resultado";

const rota = useRoute();
nextTick(() => actions.init(String(rota.params.token ?? "")));

const validade = computed(() => validadeParaTela(state.validadeAte));
const titulo = computed(() => (state.fotos.length === 1 ? "1 foto sua" : `${state.fotos.length} fotos suas`));
</script>

<template>
    <main class="tela-foto px-5 py-7">
        <p v-if="state.carregando" class="titulo">Abrindo suas fotos…</p>

        <section v-else-if="state.mensagem && state.fotos.length === 0" class="flex min-h-[70dvh] flex-col justify-center">
            <h1 class="titulo">{{ state.mensagem }}</h1>
            <BotaoPilula v-if="actions.temCaminhoParaCamera()" class="mt-6" @click="actions.voltarParaCamera()">
                Fazer a busca de novo
            </BotaoPilula>
            <router-link to="/privacidade" class="mt-4 text-xs underline">Dúvidas sobre seus dados</router-link>
        </section>

        <section v-else-if="state.fotos.length === 0" class="flex min-h-[70dvh] flex-col items-center justify-center text-center">
            <div class="mb-3 flex size-14 items-center justify-center rounded-full bg-white/20 text-2xl">🔍</div>
            <h1 class="titulo">Ainda não achamos você</h1>
            <p class="mt-2 text-xs text-white/85">
                Os fotógrafos ainda estão mandando fotos da prova. Volte mais tarde e tente de novo.
            </p>
            <BotaoPilula v-if="actions.temCaminhoParaCamera()" class="mt-6" @click="actions.voltarParaCamera()">
                Tentar outra selfie
            </BotaoPilula>
        </section>

        <template v-else>
            <p class="rotulo">{{ state.evento }}</p>
            <h1 class="titulo titulo-tela mt-1">{{ titulo }}</h1>
            <p v-if="validade" class="mt-1 text-[11px] text-white/75">Disponível até {{ validade }}</p>

            <GradeFotos class="mt-4" :fotos="state.fotos" mostrar-selo @abrir="actions.abrir" />

            <!-- Pronto, o botão vira o link (um por parte quando o ZIP vem dividido). -->
            <div v-if="state.zip === 'pronto'" class="mt-4 flex flex-col gap-2">
                <a v-for="(url, indice) in state.urlsZip" :key="url" :href="url" class="pilula block text-center">
                    {{ state.urlsZip.length === 1 ? "Baixar o ZIP" : `Baixar parte ${indice + 1} de ${state.urlsZip.length}` }}
                </a>
            </div>
            <BotaoPilula v-else class="mt-4" :desabilitado="state.zip === 'montando'" @click="actions.pedirZip()">
                {{ state.zip === "montando" ? "Preparando…" : "Baixar todas (ZIP)" }}
            </BotaoPilula>

            <p v-if="state.mensagem" class="mt-3 text-center text-xs text-white/85">{{ state.mensagem }}</p>

            <button
                v-if="actions.temCaminhoParaCamera()"
                type="button"
                class="mt-5 w-full text-center text-[11px] text-white/75"
                :disabled="state.rebuscando"
                @click="actions.rebuscar()"
            >
                {{ state.rebuscando ? "Buscando fotos novas…" : "Chegaram fotos novas? Buscar de novo" }}
            </button>

            <!-- Rebusca recusada (selfie guardada não serviu): a saída é a câmera (spec §7). -->
            <template v-if="state.mensagemRebusca && !state.rebuscando && actions.temCaminhoParaCamera()">
                <p class="mt-2 text-center text-[11px] text-white/85">{{ state.mensagemRebusca }}</p>
                <button
                    type="button"
                    class="mt-1 w-full text-center text-[11px] underline"
                    @click="actions.voltarParaCamera()"
                >
                    Tirar outra selfie
                </button>
            </template>

            <FaixaPatrocinadores :patrocinadores="[]" />
        </template>

        <FotoAberta
            v-if="state.aberta !== null && state.fotos[state.aberta]"
            :foto="state.fotos[state.aberta]"
            :pode-compartilhar="actions.podeCompartilhar()"
            :pronta-para-compartilhar="actions.prontaParaCompartilhar()"
            @fechar="actions.fechar()"
            @salvar="actions.salvar(state.aberta!)"
            @compartilhar="actions.compartilhar(state.aberta!)"
            @proxima="actions.proxima()"
            @anterior="actions.anterior()"
        />
    </main>
</template>
