<script setup lang="ts">
import { computed, onMounted, onUnmounted, reactive, ref, watch } from "vue";
import BotaoVoltar from "./BotaoVoltar.vue";
import type { FotoAbrivel } from "./interfaces";

// A foto aberta no computador: uma por vez, inteira na tela, passada pelas setas. O histórico
// e o Esc ficam com a FotoAberta, que é quem decide entre esta e a lista do celular.
const props = withDefaults(
    defineProps<{
        fotos: FotoAbrivel[];
        inicio: number;
        podeCompartilhar: boolean;
        prontaParaCompartilhar?: number | null;
        temMais?: boolean;
        carregando?: boolean;
        total?: number;
    }>(),
    { prontaParaCompartilhar: null, temMais: false, carregando: false, total: undefined },
);
const emit = defineEmits<{ fechar: []; baixar: [indice: number]; compartilhar: [indice: number]; carregarMais: [] }>();

const voltar = ref<InstanceType<typeof BotaoVoltar> | null>(null);
const carregadas = reactive(new Set<number>());
const atual = ref(props.inicio);
const foto = computed(() => props.fotos[atual.value]);

const temAnterior = computed(() => atual.value > 0);
const temProxima = computed(() => atual.value < props.fotos.length - 1 || props.temMais);

// Com mais páginas por vir e sem o total do evento, o tamanho da lista seria um "de" falso.
const contador = computed(() => {
    const total = props.total ?? (props.temMais ? undefined : props.fotos.length);
    return total ? `${atual.value + 1} de ${total.toLocaleString("pt-BR")}` : `Foto ${atual.value + 1}`;
});

// Na última foto carregada a seta pede a página seguinte; quando ela chega, segue em frente.
let esperandoMais = false;

function proxima(): void {
    if (atual.value < props.fotos.length - 1) atual.value++;
    else if (props.temMais && !props.carregando) {
        esperandoMais = true;
        emit("carregarMais");
    }
}

function anterior(): void {
    esperandoMais = false;
    if (atual.value > 0) atual.value--;
}

watch(
    () => props.fotos.length,
    (agora, antes) => {
        if (esperandoMais && agora > antes) atual.value++;
        esperandoMais = false;
    },
);

// A da frente já vem baixando enquanto esta está na tela: a troca pela seta fica imediata.
watch(
    atual,
    (indice) => {
        const seguinte = props.fotos[indice + 1];
        if (seguinte) new Image().src = seguinte.web;
    },
    { immediate: true },
);

function aoTeclar(evento: KeyboardEvent): void {
    if (evento.key === "ArrowRight") proxima();
    else if (evento.key === "ArrowLeft") anterior();
}

onMounted(() => {
    window.addEventListener("keydown", aoTeclar);
    (voltar.value?.$el as HTMLElement | undefined)?.focus({ preventScroll: true });
});

onUnmounted(() => window.removeEventListener("keydown", aoTeclar));
</script>

<template>
    <div class="fixed inset-0 z-50 flex flex-col bg-[var(--largada-foto)] text-white">
        <header class="flex items-center justify-between px-4 py-3">
            <BotaoVoltar ref="voltar" variante="vidro" @click="emit('fechar')" />

            <div class="flex items-center gap-2">
                <!-- O Safari do Mac também só abre o menu colado no clique: a foto baixada espera o segundo. -->
                <span v-if="prontaParaCompartilhar === atual" class="rounded-full bg-white px-3 py-2 text-xs font-bold text-[var(--largada-fim)]">
                    Clique de novo para compartilhar
                </span>
                <button
                    v-if="podeCompartilhar"
                    type="button"
                    class="botao-foto"
                    :class="{ 'botao-foto-pronto': prontaParaCompartilhar === atual }"
                    :aria-label="`Compartilhar a foto ${atual + 1}`"
                    @click="emit('compartilhar', atual)"
                >
                    <svg viewBox="0 0 24 24" class="size-6" fill="currentColor" aria-hidden="true">
                        <path d="M13.5 4.5 21 11.6l-7.5 7.1v-4.2c-5.3 0-8.6 1.6-11 5.1 1-5.2 4-10 11-10.9z" />
                    </svg>
                </button>
                <button type="button" class="botao-foto" :aria-label="`Baixar a foto ${atual + 1}`" @click="emit('baixar', atual)">
                    <svg viewBox="0 0 24 24" class="size-6" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                        <path d="M12 4v11M7 10.5l5 5 5-5M5 20h14" />
                    </svg>
                </button>
            </div>
        </header>

        <div class="relative min-h-0 flex-1">
            <!-- Miniatura e versão grande no mesmo quadro: a miniatura aparece na hora e a
                 grande entra por cima quando chega. Com o mesmo formato, as duas coincidem. -->
            <figure v-if="foto" :key="foto.id_foto" :data-foto="atual" class="absolute inset-x-20 inset-y-0">
                <img :src="foto.thumb" alt="" class="absolute inset-0 h-full w-full object-contain" />
                <img
                    :src="foto.web"
                    :alt="`Foto ${atual + 1} do evento`"
                    decoding="async"
                    class="foto-da-lista-web object-contain"
                    :data-carregada="carregadas.has(foto.id_foto) || undefined"
                    @load="carregadas.add(foto.id_foto)"
                />
            </figure>

            <button
                v-if="temAnterior"
                type="button"
                aria-label="Foto anterior"
                class="botao-foto absolute left-4 top-1/2 size-12 -translate-y-1/2 rounded-full"
                @click="anterior"
            >
                <svg viewBox="0 0 24 24" class="size-7" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                    <path d="M15 5l-7 7 7 7" />
                </svg>
            </button>
            <button
                v-if="temProxima"
                type="button"
                aria-label="Próxima foto"
                class="botao-foto absolute right-4 top-1/2 size-12 -translate-y-1/2 rounded-full disabled:opacity-40"
                :disabled="carregando && atual === fotos.length - 1"
                @click="proxima"
            >
                <svg viewBox="0 0 24 24" class="size-7" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                    <path d="M9 5l7 7-7 7" />
                </svg>
            </button>
        </div>

        <p class="py-4 text-center text-sm tabular-nums text-white/75" aria-live="polite">{{ contador }}</p>
    </div>
</template>
