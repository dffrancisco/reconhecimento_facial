<script setup lang="ts">
import type { FotoNaGrade } from "./interfaces";

defineProps<{ foto: FotoNaGrade; podeCompartilhar: boolean }>();
const emit = defineEmits<{ fechar: []; salvar: []; compartilhar: []; proxima: []; anterior: [] }>();

// Deslize horizontal troca de foto; abaixo de 50 px é um toque, não um gesto.
const MINIMO_DESLIZE_PX = 50;
let inicio: { x: number; y: number } | null = null;

function comecar(evento: TouchEvent): void {
    const toque = evento.changedTouches[0];
    inicio = toque ? { x: toque.clientX, y: toque.clientY } : null;
}

function terminar(evento: TouchEvent): void {
    const toque = evento.changedTouches[0];
    if (!inicio || !toque) return;
    const dx = toque.clientX - inicio.x;
    const dy = toque.clientY - inicio.y;
    inicio = null;
    if (Math.abs(dx) < MINIMO_DESLIZE_PX || Math.abs(dx) < Math.abs(dy)) return;
    if (dx < 0) emit("proxima");
    else emit("anterior");
}
</script>

<template>
    <div class="fixed inset-0 z-50 flex flex-col bg-[#0e0e12]">
        <button type="button" aria-label="Fechar" class="absolute right-4 top-4 z-10 text-2xl text-white" @click="$emit('fechar')">
            ×
        </button>
        <div data-deslize class="flex flex-1 items-center justify-center" @touchstart="comecar" @touchend="terminar">
            <img :src="foto.thumb" alt="Sua foto no evento" class="max-h-full max-w-full object-contain" />
        </div>
        <div class="flex gap-2 px-4 pb-6 pt-3">
            <button type="button" class="pilula" @click="$emit('salvar')">Salvar</button>
            <button v-if="podeCompartilhar" type="button" class="pilula-vazada" @click="$emit('compartilhar')">
                Compartilhar
            </button>
        </div>
    </div>
</template>
