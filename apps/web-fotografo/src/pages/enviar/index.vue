<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref } from "vue";
import { estadoConexao, tempoRestante } from "../../ts/tempo";
import { actions, semConexaoDesde, state } from "./enviar";

const entradaArquivos = ref<HTMLInputElement | null>(null);
const arrastando = ref(false);

nextTick(() => actions.init());

// Fechar a aba com fotos na fila perderia o envio em andamento: o navegador pergunta antes.
function aoSair(evento: BeforeUnloadEvent): void {
    if (!actions.temEnvioPendente()) return;
    evento.preventDefault();
    evento.returnValue = "";
}

onMounted(() => window.addEventListener("beforeunload", aoSair));
onUnmounted(() => {
    window.removeEventListener("beforeunload", aoSair);
    actions.encerrar();
});

const conexao = computed(() => estadoConexao(semConexaoDesde(), state.agora));
const totalErros = computed(() => state.comErro + state.recusados.length + state.estacao.com_erro);
const total = computed(() => state.enviados + state.pulados + state.esperando);
const feitas = computed(() => state.enviados + state.pulados);
const porcentagem = computed(() => (state.bytesTotais > 0 ? Math.floor((state.bytesEnviados / state.bytesTotais) * 100) : 0));
const restante = computed(() => tempoRestante(state.bytesTotais - state.bytesEnviados, state.bytesPorSegundo));
const megas = (bytes: number) => `${Math.max(1, Math.round(bytes / (1024 * 1024)))} MB`;
const plural = (n: number, um: string, varios: string) => (n === 1 ? um : varios.replace("N", String(n)));

function aoSoltar(evento: DragEvent): void {
    arrastando.value = false;
    if (evento.dataTransfer) actions.soltar(evento.dataTransfer);
}

function aoEscolher(evento: Event): void {
    const entrada = evento.target as HTMLInputElement;
    if (entrada.files?.length) actions.escolher(Array.from(entrada.files));
    entrada.value = "";
}
</script>

<template>
    <main class="pagina">
        <header class="flex items-center justify-between border-b border-[var(--borda)] bg-white px-4 py-2.5">
            <div>
                <span class="selo mr-2"></span><b>{{ state.evento || "Envio de fotos" }}</b>
                <span v-if="state.fotografo" class="apagado"> · {{ state.fotografo }}</span>
            </div>
            <span
                v-if="!state.bloqueio && !state.carregando"
                class="rounded-full px-2.5 py-0.5 text-[11px] font-bold"
                :class="{
                    'bg-[var(--sucesso-fundo)] text-[var(--sucesso)]': conexao === 'conectado',
                    'bg-[var(--aviso-fundo)] text-[var(--aviso)]': conexao === 'tentando',
                    'bg-red-50 text-[var(--erro)]': conexao === 'alerta',
                }"
            >
                {{ conexao === "conectado" ? "● Conectado à estação" : "Sem conexão com a estação — tentando de novo" }}
            </span>
        </header>

        <div class="mx-auto max-w-4xl p-4">
            <p v-if="state.carregando" class="apagado">Abrindo…</p>

            <div v-else-if="state.bloqueio" class="superficie mt-8 p-6 text-center">
                <p class="text-base font-extrabold">{{ state.bloqueio }}</p>
            </div>

            <template v-else>
                <div v-if="state.pendentesAnteriores > 0" class="aviso mb-3 flex items-center justify-between gap-3 px-3 py-2">
                    <span>
                        <b>{{ plural(state.pendentesAnteriores, "1 foto ficou pendente da última vez.", "N fotos ficaram pendentes da última vez.") }}</b>
                        Solte a mesma pasta de novo para continuar — o que já chegou não é reenviado.
                    </span>
                    <button type="button" class="botao-secundario shrink-0" data-acao="esquecer" @click="actions.esquecerPendentes()">
                        Esquecer pendentes
                    </button>
                </div>

                <div v-if="state.parada" class="aviso mb-3 flex items-center justify-between gap-3 px-3 py-2">
                    <b>{{ state.parada }}</b>
                    <button type="button" class="botao shrink-0" @click="actions.alternarPausa()">Continuar</button>
                </div>

                <div
                    class="superficie cursor-pointer border-2 border-dashed p-6 text-center"
                    :class="arrastando ? 'border-[var(--barra)]' : 'border-[#d4d4dc]'"
                    @click="entradaArquivos?.click()"
                    @dragover.prevent="arrastando = true"
                    @dragleave="arrastando = false"
                    @drop.prevent="aoSoltar"
                >
                    <b class="text-sm">Solte a pasta ou as fotos aqui</b><br />
                    <span class="apagado">ou clique para escolher · só JPEG</span>
                </div>
                <input ref="entradaArquivos" type="file" accept=".jpg,.jpeg,image/jpeg" multiple class="hidden" @change="aoEscolher" />

                <div class="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
                    <div class="superficie px-3 py-2" data-contador="enviadas"><b class="numero">{{ state.enviados }}</b><span class="apagado">enviadas</span></div>
                    <div class="superficie px-3 py-2" data-contador="prontas">
                        <b class="numero text-[var(--sucesso)]">{{ state.estacao.prontas }}</b><span class="apagado">prontas na estação</span>
                    </div>
                    <div class="superficie px-3 py-2" data-contador="esperando"><b class="numero">{{ state.esperando }}</b><span class="apagado">esperando envio</span></div>
                    <div class="superficie px-3 py-2" data-contador="erros"><b class="numero text-[var(--erro)]">{{ totalErros }}</b><span class="apagado">com erro</span></div>
                </div>

                <div class="mt-2 flex flex-wrap items-center justify-between gap-2">
                    <span><b>{{ feitas }} de {{ total }}</b> · {{ porcentagem }}% · <span class="apagado">{{ restante }}</span></span>
                    <span class="flex items-center gap-2">
                        <span class="apagado">Enviar</span>
                        <select
                            class="botao-secundario"
                            :value="state.porVez"
                            aria-label="Fotos enviadas ao mesmo tempo"
                            @change="actions.mudarPorVez(Number(($event.target as HTMLSelectElement).value))"
                        >
                            <option v-for="n in 6" :key="n" :value="n">{{ n }}</option>
                        </select>
                        <span class="apagado">por vez</span>
                        <button type="button" class="botao" data-acao="pausar" @click="actions.alternarPausa()">
                            {{ state.pausada || state.parada ? "Continuar" : "Pausar" }}
                        </button>
                    </span>
                </div>
                <div class="trilho mt-1.5"><i :style="{ width: `${porcentagem}%` }"></i></div>

                <template v-if="state.emAndamento.length > 0">
                    <p class="rotulo-secao mt-4 mb-1">Enviando agora</p>
                    <div v-for="item in state.emAndamento" :key="item.chave" class="grid grid-cols-[1fr_45%_70px] items-center gap-2 border-t border-[#ececf0] py-1.5">
                        <span class="truncate">{{ item.nome }} <span class="apagado">· {{ megas(item.tamanho) }}</span></span>
                        <div class="trilho h-[5px]"><i :style="{ width: `${Math.round(item.progresso * 100)}%` }"></i></div>
                        <span class="apagado">{{ item.situacao === "preparando" ? "preparando" : `${Math.round(item.progresso * 100)}%` }}</span>
                    </div>
                </template>

                <template v-if="totalErros > 0 || state.ignorados.length > 0">
                    <p class="rotulo-secao mt-4 mb-1">Com erro</p>
                    <div v-for="item in state.comErroItens" :key="item.chave" class="grid grid-cols-[1fr_2fr_auto] items-center gap-2 border-t border-[#ececf0] py-1.5">
                        <span class="truncate">{{ item.nome }}</span>
                        <span class="text-[var(--erro)]">{{ item.mensagem }}</span>
                        <button type="button" class="botao-secundario" @click="actions.tentarDeNovo(item.chave)">Tentar de novo</button>
                    </div>
                    <div v-for="r in state.recusados" :key="`r-${r.nome}`" class="grid grid-cols-[1fr_2fr_auto] items-center gap-2 border-t border-[#ececf0] py-1.5">
                        <span class="truncate">{{ r.nome }}</span>
                        <span class="text-[var(--erro)]">{{ r.mensagem }}</span>
                        <span></span>
                    </div>
                    <div v-for="e in state.estacao.erros" :key="`e-${e.nome_arquivo}`" class="grid grid-cols-[1fr_2fr_auto] items-center gap-2 border-t border-[#ececf0] py-1.5">
                        <span class="truncate">{{ e.nome_arquivo }}</span>
                        <span class="text-[var(--erro)]">{{ e.mensagem }}</span>
                        <span></span>
                    </div>
                    <p v-if="state.ignorados.length > 0" class="apagado border-t border-[#ececf0] py-1.5">
                        {{ plural(state.ignorados.length, "1 arquivo que não é JPEG foi ignorado", "N arquivos que não são JPEG foram ignorados") }}
                        (ex.: {{ state.ignorados[0] }}).
                    </p>
                </template>

                <p v-if="state.pulados > 0" class="apagado mt-3">
                    {{ plural(state.pulados, "1 foto já estava na estação e foi pulada.", "N fotos já estavam na estação e foram puladas.") }}
                </p>
                <p class="apagado mt-3">Deixe o notebook ligado e com esta tela aberta até terminar.</p>
            </template>
        </div>
    </main>
</template>
