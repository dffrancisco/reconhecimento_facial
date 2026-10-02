<script setup lang="ts">
import { computed } from "vue";
import QrCode from "../../../componentes/QrCode.vue";
import { actions, state } from "../evento";

const links = computed(() => {
    const e = state.evento;
    if (!e?.links) return [];
    return [
        { chave: "participante" as const, titulo: e.privado === "S" ? "Participante (evento privado: entra pela chave)" : "Participante", url: e.links.participante },
        { chave: "anfitriao" as const, titulo: "Anfitrião (vê o evento inteiro, sem selfie)", url: e.links.anfitriao },
    ];
});
</script>

<template>
    <section v-if="state.evento" class="superficie mt-4 p-4" data-bloco="links">
        <p class="rotulo-secao">Links</p>
        <p v-if="!state.evento.links" class="aviso mt-2 px-3 py-2">Configure ENDERECO_PARTICIPANTE no VPS para ver os links.</p>
        <template v-else>
            <p v-if="state.evento.ativo === 'N'" class="aviso mt-2 px-3 py-2">Evento inativo: o participante não consegue buscar as fotos.</p>
            <div v-for="l in links" :key="l.chave" class="mt-3" :data-link="l.chave">
                <p class="font-bold">{{ l.titulo }}</p>
                <div class="mt-1 flex flex-wrap items-center gap-2">
                    <QrCode :texto="l.url" />
                    <span class="apagado break-all">{{ l.url }}</span>
                    <button type="button" class="botao-secundario" :data-acao="`copiar-${l.chave}`" @click="actions.copiar(l.chave, l.url)">
                        {{ state.copiado === l.chave ? "Copiado ✓" : "Copiar" }}
                    </button>
                    <button type="button" class="botao-secundario" :data-acao="`qr-${l.chave}`" @click="actions.abrirQr(l.url)">QR grande</button>
                </div>
            </div>
        </template>

        <!-- undefined: a consulta da estação falhou; a linha some e o resto da página segue. -->
        <div v-if="state.estacao !== undefined" class="mt-4 border-t border-[#ececf0] pt-3" data-link="estacao">
            <p class="font-bold">Estação (painel dos fotógrafos)</p>
            <template v-if="state.estacao?.painel">
                <div class="mt-1 flex flex-wrap items-center gap-2">
                    <span class="apagado break-all">{{ state.estacao.painel }}</span>
                    <a :href="state.estacao.painel" target="_blank" rel="noopener" class="botao-secundario" data-acao="abrir-estacao">Abrir</a>
                    <button type="button" class="botao-secundario" data-acao="copiar-estacao" @click="actions.copiar('estacao', state.estacao.painel)">
                        {{ state.copiado === "estacao" ? "Copiado ✓" : "Copiar" }}
                    </button>
                </div>
                <p v-if="state.estacao.painel_tunel" class="apagado mt-1 break-all">Pelo túnel (de fora da rede): {{ state.estacao.painel_tunel }}</p>
                <p class="apagado mt-1">Abre só num aparelho conectado à mesma rede da estação.</p>
            </template>
            <p v-else-if="state.estacao" class="apagado mt-1">
                A estação não informou o endereço na rede. Configure ENDERECO_LAN no .env.estacao e suba a estação de novo.
            </p>
            <p v-else class="apagado mt-1">A estação ainda não deu sinal. Ligue a estação com internet: em até 1 minuto o link aparece aqui.</p>
        </div>

        <p v-if="state.mensagemLinks" class="apagado mt-2">{{ state.mensagemLinks }}</p>

        <div v-if="state.qrGrande" data-qr-grande class="fixed inset-0 z-50 flex flex-col items-center justify-center bg-white p-6" @click="actions.fecharQr()">
            <QrCode :texto="state.qrGrande" :tamanho="320" />
            <p class="apagado mt-4 break-all text-center">{{ state.qrGrande }}</p>
            <button type="button" class="botao mt-4">Fechar</button>
        </div>
    </section>
</template>
