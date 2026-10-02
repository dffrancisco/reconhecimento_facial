<script setup lang="ts">
import { nextTick, onMounted, onUnmounted, reactive, ref } from "vue";
import BotaoVoltar from "./BotaoVoltar.vue";
import type { FotoAbrivel } from "./interfaces";

const props = withDefaults(
    defineProps<{
        fotos: FotoAbrivel[];
        inicio: number;
        podeCompartilhar: boolean;
        prontaParaCompartilhar?: number | null;
        temMais?: boolean;
        carregando?: boolean;
    }>(),
    { prontaParaCompartilhar: null, temMais: false, carregando: false },
);
const emit = defineEmits<{ fechar: []; baixar: [indice: number]; compartilhar: [indice: number]; carregarMais: [] }>();

const lista = ref<HTMLElement | null>(null);
const voltar = ref<InstanceType<typeof BotaoVoltar> | null>(null);
const carregadas = reactive(new Set<number>());

// No Android o voltar (gesto ou botão) é o jeito natural de sair da tela cheia: uma entrada
// própria no histórico faz ele fechar a lista, em vez de sair do resultado para a câmera.
// O estado do vue-router vai junto na entrada, para ele não estranhar o voltar.
function aoVoltar(): void {
    emit("fechar");
}

function aoTeclar(evento: KeyboardEvent): void {
    if (evento.key === "Escape") fechar();
}

// A seta desfaz a entrada; é o popstate que fecha, igual ao voltar do celular.
function fechar(): void {
    if (history.state?.fotoAberta) history.back();
    else emit("fechar");
}

// As miniaturas de cima costumam estar no cache da grade; sem esperar por elas, a altura das
// fotos acima muda depois de rolar e a lista sai da foto tocada. O limite cobre a que não veio.
const ESPERA_MINIATURAS_MS = 1200;

async function irParaFotoTocada(): Promise<void> {
    await nextTick();
    const acima = Array.from(lista.value?.querySelectorAll<HTMLImageElement>("img[data-miniatura]") ?? []).slice(0, props.inicio + 1);
    let limite: ReturnType<typeof setTimeout> | undefined;
    await Promise.race([
        Promise.all(acima.map((img) => img.decode?.().catch(() => undefined))),
        new Promise((pronto) => (limite = setTimeout(pronto, ESPERA_MINIATURAS_MS))),
    ]);
    clearTimeout(limite);
    lista.value?.querySelector(`[data-foto="${props.inicio}"]`)?.scrollIntoView({ block: "start" });
}

onMounted(() => {
    history.pushState({ ...history.state, fotoAberta: true }, "");
    window.addEventListener("popstate", aoVoltar);
    window.addEventListener("keydown", aoTeclar);
    // Quem navega pelo teclado cai dentro da lista, não atrás dela.
    (voltar.value?.$el as HTMLElement | undefined)?.focus({ preventScroll: true });
    void irParaFotoTocada();
});

// Fechada por outro caminho (um erro no baixar, por exemplo): tira a entrada que sobrou,
// senão o próximo voltar pareceria não fazer nada.
onUnmounted(() => {
    window.removeEventListener("popstate", aoVoltar);
    window.removeEventListener("keydown", aoTeclar);
    if (history.state?.fotoAberta) history.back();
});
</script>

<template>
    <div ref="lista" class="fixed inset-0 z-50 overflow-y-auto overscroll-contain bg-[var(--largada-foto)] text-white">
        <BotaoVoltar ref="voltar" variante="vidro" class="fixed left-3 top-[calc(env(safe-area-inset-top)+0.75rem)] z-10" @click="fechar" />

        <div class="mx-auto flex max-w-xl flex-col gap-3 px-3 pb-10 pt-[calc(env(safe-area-inset-top)+0.75rem)]">
            <figure v-for="(foto, indice) in fotos" :key="foto.id_foto" :data-foto="indice" class="foto-da-lista">
                <!-- A miniatura dá o formato da foto na hora (e fica de fundo enquanto a grande
                     chega); a grande vem por cima, só quando chega perto da tela. -->
                <img
                    data-miniatura
                    :src="foto.thumb"
                    alt=""
                    :loading="indice <= inicio ? 'eager' : 'lazy'"
                    decoding="async"
                    class="block h-auto w-full"
                />
                <img
                    :src="foto.web"
                    :alt="`Foto ${indice + 1} do evento`"
                    loading="lazy"
                    decoding="async"
                    class="foto-da-lista-web"
                    :data-carregada="carregadas.has(foto.id_foto) || undefined"
                    @load="carregadas.add(foto.id_foto)"
                />

                <div class="absolute bottom-3 right-3 flex items-center gap-2">
                    <!-- No iPhone o menu só abre colado no toque: a foto já baixada espera o segundo. -->
                    <span
                        v-if="prontaParaCompartilhar === indice"
                        class="rounded-full bg-white px-3 py-2 text-xs font-bold text-[var(--largada-fim)]"
                    >
                        Toque de novo para compartilhar
                    </span>
                    <button
                        v-if="podeCompartilhar"
                        type="button"
                        class="botao-foto"
                        :class="{ 'botao-foto-pronto': prontaParaCompartilhar === indice }"
                        :aria-label="`Compartilhar a foto ${indice + 1}`"
                        @click="emit('compartilhar', indice)"
                    >
                        <svg viewBox="0 0 24 24" class="size-6" fill="currentColor" aria-hidden="true">
                            <path d="M13.5 4.5 21 11.6l-7.5 7.1v-4.2c-5.3 0-8.6 1.6-11 5.1 1-5.2 4-10 11-10.9z" />
                        </svg>
                    </button>
                    <button type="button" class="botao-foto" :aria-label="`Baixar a foto ${indice + 1}`" @click="emit('baixar', indice)">
                        <svg viewBox="0 0 24 24" class="size-6" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                            <path d="M12 4v11M7 10.5l5 5 5-5M5 20h14" />
                        </svg>
                    </button>
                </div>
            </figure>

            <button v-if="temMais" data-ver-mais type="button" class="pilula-vazada mt-2" :disabled="carregando" @click="emit('carregarMais')">
                {{ carregando ? "Carregando…" : "Ver mais fotos" }}
            </button>
        </div>
    </div>
</template>
