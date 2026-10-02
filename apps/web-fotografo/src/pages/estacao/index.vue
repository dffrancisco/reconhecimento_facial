<script setup lang="ts">
import { computed, nextTick, onUnmounted, ref } from "vue";
import QrCode from "../../componentes/QrCode.vue";
import { enderecoDosLinks, linkDeUpload } from "../../ts/links";
import { actions, state } from "./estacao";
import type { EventoAberto } from "./interfaces";

const usuario = ref("");
const senha = ref("");

nextTick(() => actions.init());
onUnmounted(() => actions.encerrar());

const p = computed(() => state.painel);
const enderecos = computed(() => enderecoDosLinks(p.value?.enderecos.lan ?? null, location.origin));
const linkDe = (token: string) => linkDeUpload(enderecos.value.endereco, token);
const linkTunel = (token: string) => (p.value?.enderecos.tunel ? linkDeUpload(p.value.enderecos.tunel, token) : "");

const segundos = (ms: number) => (ms > 0 ? `${Math.round(ms / 1000)} s` : "—");
const porcento = (v: number) => `${(v * 100).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`;
const gb = (mb: number) => (mb / 1024).toLocaleString("pt-BR", { maximumFractionDigits: 1 });
// Montada do texto, sem `Date`: "2026-09-26" viraria o dia 25 no fuso do Brasil.
const data = (ymd: string) => ymd.split("-").reverse().join("/");
const periodo = (e: EventoAberto) => (e.data_inicio && e.data_inicio !== e.data_fim ? `${data(e.data_inicio)} a ${data(e.data_fim)}` : data(e.data_fim));
const escolher = (ev: Event) => actions.escolherEvento(Number((ev.target as HTMLSelectElement).value));

// Mais de 3 min sem sincronizar já é problema: eventos e fotógrafos novos não chegam.
const vps = computed(() => {
    const ultima = p.value?.vps.ultima_sincronizacao;
    if (!ultima) return { ok: false, texto: "VPS: nunca sincronizou" };
    const s = Math.max(0, Math.round((state.agora - new Date(ultima).getTime()) / 1000));
    const quanto = s < 60 ? `${s} s` : `${Math.round(s / 60)} min`;
    return s <= 180 ? { ok: true, texto: `VPS conectado · sincronizou há ${quanto}` } : { ok: false, texto: `VPS sem sincronizar há ${quanto}` };
});
const errosComFoto = computed(() => p.value?.erros.length ?? 0);

const etapas = [
    { chave: "recebidas", nome: "Recebidas" },
    { chave: "rostos", nome: "Rostos" },
    { chave: "derivados", nome: "Versões web" },
    { chave: "esperando_publicar", nome: "Esperando publicar" },
] as const;
const maiorEtapa = computed(() => Math.max(1, ...etapas.map((e) => p.value?.fila[e.chave] ?? 0)));
</script>

<template>
    <main class="pagina">
        <header class="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--borda)] bg-white px-4 py-2.5">
            <div class="flex flex-wrap items-center gap-2">
                <span><span class="selo mr-2"></span><b>Estação</b></span>
                <template v-if="state.sessao && p?.evento">
                    <select
                        v-if="p.eventos_abertos.length > 1"
                        data-acao="escolher-evento"
                        aria-label="Evento acompanhado no painel"
                        class="rounded-lg border border-[var(--borda)] bg-white px-2 py-1"
                        :value="p.evento.id_evento"
                        @change="escolher"
                    >
                        <option v-for="e in p.eventos_abertos" :key="e.id_evento" :value="e.id_evento">{{ e.nome }} · {{ periodo(e) }}</option>
                    </select>
                    <span v-else class="apagado">· {{ p.evento.nome }} · {{ periodo(p.evento) }}</span>
                </template>
            </div>
            <div v-if="state.sessao" class="flex items-center gap-3">
                <span
                    v-if="p"
                    class="rounded-full px-2.5 py-0.5 text-[11px] font-bold"
                    :class="vps.ok ? 'bg-[var(--sucesso-fundo)] text-[var(--sucesso)]' : 'bg-red-50 text-[var(--erro)]'"
                >
                    ● {{ vps.texto }}
                </span>
                <span class="apagado">{{ state.sessao.nome }} · <button type="button" class="underline" @click="actions.sair()">Sair</button></span>
            </div>
        </header>

        <div class="mx-auto max-w-5xl p-4">
            <p v-if="state.carregando" class="apagado">Abrindo…</p>

            <form v-else-if="!state.sessao" class="superficie mx-auto mt-10 max-w-sm p-6" @submit.prevent="actions.entrar(usuario, senha)">
                <p class="rotulo-secao">Painel da estação</p>
                <h1 class="mt-1 text-lg font-extrabold">Entrar</h1>
                <label class="mt-4 block">
                    <span class="apagado">Login</span>
                    <input v-model="usuario" name="login" autocomplete="username" class="mt-1 w-full rounded-lg border border-[var(--borda)] px-3 py-2" />
                </label>
                <label class="mt-3 block">
                    <span class="apagado">Senha</span>
                    <input v-model="senha" name="senha" type="password" autocomplete="current-password" class="mt-1 w-full rounded-lg border border-[var(--borda)] px-3 py-2" />
                </label>
                <p v-if="state.erroLogin" class="mt-3 text-[var(--erro)]">{{ state.erroLogin }}</p>
                <button type="submit" class="botao mt-4 w-full">Entrar</button>
            </form>

            <div v-else-if="!p?.evento" class="superficie mt-8 p-6 text-center">
                <p class="text-base font-extrabold">Nenhum evento em andamento nesta estação.</p>
                <template v-if="p && p.eventos_abertos.length > 0">
                    <p class="apagado mt-2">Os eventos abertos são de outras datas. Para acompanhar um deles mesmo assim, escolha:</p>
                    <select
                        data-acao="escolher-evento"
                        aria-label="Evento acompanhado no painel"
                        class="mt-3 rounded-lg border border-[var(--borda)] bg-white px-3 py-2"
                        @change="escolher"
                    >
                        <option value="" disabled selected>Escolha o evento…</option>
                        <option v-for="e in p.eventos_abertos" :key="e.id_evento" :value="e.id_evento">{{ e.nome }} · {{ periodo(e) }}</option>
                    </select>
                </template>
                <p v-else class="apagado mt-2">Crie ou reative o evento no admin e aguarde a sincronização.</p>
            </div>

            <template v-else>
                <div class="grid grid-cols-2 gap-2 sm:grid-cols-4">
                    <div class="superficie px-3 py-2" data-numero="fotos-min"><b class="numero">{{ p.metricas.fotos_min }}</b><span class="apagado">fotos/min · 5 min</span></div>
                    <div class="superficie px-3 py-2" data-numero="latencia">
                        <b class="numero">{{ segundos(p.metricas.latencia_p50_ms) }}</b>
                        <span class="apagado">da chegada à publicação (p95 {{ segundos(p.metricas.latencia_p95_ms) }})</span>
                    </div>
                    <div class="superficie px-3 py-2" data-numero="erro">
                        <b class="numero" :class="p.metricas.taxa_erro > 0.05 ? 'text-[var(--erro)]' : 'text-[var(--sucesso)]'">{{ porcento(p.metricas.taxa_erro) }}</b>
                        <span class="apagado">com erro · 30 min</span>
                    </div>
                    <div class="superficie px-3 py-2" data-numero="gpu">
                        <template v-if="p.metricas.gpu">
                            <b class="numero">{{ p.metricas.gpu.utilizacao }}%</b>
                            <span class="apagado">placa de vídeo · {{ gb(p.metricas.gpu.vram_usada_mb) }} de {{ gb(p.metricas.gpu.vram_total_mb) }} GB</span>
                        </template>
                        <template v-else><b class="numero">—</b><span class="apagado">placa de vídeo</span></template>
                    </div>
                </div>

                <p class="rotulo-secao mt-4 mb-1">Fila por etapa</p>
                <div v-for="etapa in etapas" :key="etapa.chave" :data-etapa="etapa.chave" class="grid grid-cols-[150px_1fr_50px] items-center gap-3 py-0.5">
                    <span>{{ etapa.nome }}</span>
                    <div class="trilho h-[5px]"><i :style="{ width: `${(p.fila[etapa.chave] / maiorEtapa) * 100}%` }"></i></div>
                    <b>{{ p.fila[etapa.chave] }}</b>
                </div>

                <p class="rotulo-secao mt-4 mb-1">Fotógrafos do evento</p>
                <p v-if="enderecos.soNesteComputador" class="aviso mb-2 px-3 py-2">
                    Este endereço só funciona neste computador. Configure ENDERECO_LAN na estação (ex.: http://192.168.0.10) ou abra o painel
                    pelo IP da rede local, para o link e o QR abrirem no celular do fotógrafo.
                </p>
                <p v-if="p.fotografos.length === 0" class="apagado">Nenhum fotógrafo vinculado a este evento. Vincule no admin.</p>
                <div v-else class="superficie overflow-x-auto">
                    <table class="w-full">
                        <thead>
                            <tr class="rotulo-secao text-left">
                                <th class="px-3 py-2">Fotógrafo</th>
                                <th class="px-3 py-2">Enviadas</th>
                                <th class="px-3 py-2">Prontas</th>
                                <th class="px-3 py-2">Erros</th>
                                <th class="px-3 py-2">Link de upload</th>
                            </tr>
                        </thead>
                        <tbody>
                            <tr v-for="f in p.fotografos" :key="f.id_evento_fotografo" class="border-t border-[#ececf0]">
                                <td class="px-3 py-2">{{ f.nome }}</td>
                                <td class="px-3 py-2">{{ f.enviadas }}</td>
                                <td class="px-3 py-2">{{ f.prontas }}</td>
                                <td class="px-3 py-2" :class="{ 'text-[var(--erro)]': f.com_erro > 0 }">{{ f.com_erro }}</td>
                                <td class="px-3 py-2">
                                    <div class="flex flex-wrap items-center gap-2">
                                        <QrCode :texto="linkDe(f.token_upload)" />
                                        <span class="apagado break-all">{{ linkDe(f.token_upload) }}</span>
                                        <button
                                            type="button"
                                            class="botao-secundario"
                                            data-acao="copiar"
                                            @click="actions.copiar(linkDe(f.token_upload), f.token_upload, f.nome)"
                                        >
                                            {{ state.copiado === f.token_upload ? "Copiado ✓" : "Copiar" }}
                                        </button>
                                        <button type="button" class="botao-secundario" data-acao="qr-grande" @click="actions.abrirQr(linkDe(f.token_upload))">QR grande</button>
                                    </div>
                                    <p v-if="linkTunel(f.token_upload)" class="apagado mt-1 break-all">Pelo túnel (quem está longe): {{ linkTunel(f.token_upload) }}</p>
                                </td>
                            </tr>
                        </tbody>
                    </table>
                </div>

                <template v-if="p.erros.length > 0">
                    <div class="mt-4 mb-1 flex items-center justify-between">
                        <p class="rotulo-secao">Erros de processamento</p>
                        <button type="button" class="botao-secundario" data-acao="reprocessar-todos" @click="actions.reprocessar()">Reprocessar todos</button>
                    </div>
                    <div class="superficie">
                        <div v-for="e in p.erros" :key="e.id_foto" class="grid grid-cols-[1.2fr_90px_2fr_auto] items-center gap-2 border-t border-[#ececf0] px-3 py-2 first:border-t-0">
                            <span class="truncate">{{ e.nome_arquivo }} <span v-if="e.fotografo" class="apagado">· {{ e.fotografo }}</span></span>
                            <span class="apagado">{{ e.etapa ?? "—" }}</span>
                            <span class="text-[var(--erro)]">{{ e.erro }}</span>
                            <button v-if="e.tem_arquivo" type="button" class="botao-secundario" :data-acao="`reprocessar-${e.id_foto}`" @click="actions.reprocessar(e.id_foto)">
                                Reprocessar
                            </button>
                            <span v-else class="apagado">Peça ao fotógrafo para reenviar</span>
                        </div>
                    </div>
                </template>

                <p v-if="state.mensagem" class="apagado mt-3">{{ state.mensagem }}</p>

                <div class="mt-5 flex flex-wrap items-center justify-between gap-3">
                    <span class="apagado">Encerrar só libera quando nenhuma foto estiver em processamento.</span>
                    <button type="button" class="botao-perigo" data-acao="encerrar" :disabled="p.em_processamento > 0" @click="actions.pedirEncerrar()">
                        Encerrar evento
                    </button>
                </div>

                <div v-if="state.confirmandoEncerrar" class="aviso mt-3 px-4 py-3">
                    <p>
                        <b>Encerrar apaga os rostos guardados nesta estação e os links param de aceitar fotos.</b>
                        As fotos publicadas continuam no ar.
                        <template v-if="errosComFoto > 0"> {{ errosComFoto === 1 ? "1 foto com erro não será publicada." : `${errosComFoto} fotos com erro não serão publicadas.` }}</template>
                    </p>
                    <div class="mt-2 flex gap-2">
                        <button type="button" class="botao-perigo" data-acao="confirmar-encerrar" @click="actions.confirmarEncerrar()">Encerrar agora</button>
                        <button type="button" class="botao-secundario" @click="actions.cancelarEncerrar()">Cancelar</button>
                    </div>
                </div>
            </template>
        </div>

        <div v-if="state.qrGrande" data-qr-grande class="fixed inset-0 z-50 flex flex-col items-center justify-center bg-white p-6" @click="actions.fecharQr()">
            <QrCode :texto="state.qrGrande" :tamanho="320" />
            <p class="apagado mt-4 break-all text-center">{{ state.qrGrande }}</p>
            <button type="button" class="botao mt-4">Fechar</button>
        </div>
    </main>
</template>
