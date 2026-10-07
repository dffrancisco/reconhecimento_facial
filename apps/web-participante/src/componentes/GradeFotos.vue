<script setup lang="ts">
import type { FotoNaGrade } from "./interfaces";

withDefaults(defineProps<{ fotos: FotoNaGrade[]; mostrarSelo?: boolean }>(), { mostrarSelo: false });
defineEmits<{ abrir: [indice: number] }>();

function porcentagem(valor: number | undefined): string {
    return `${Math.round((valor ?? 0) * 100)}%`;
}
</script>

<template>
    <!-- Mais colunas conforme a tela cresce: duas no computador seriam meia tela cada uma,
         e a miniatura (400 px) esticada a esse tamanho fica borrada. -->
    <div class="grid grid-cols-2 gap-1.5 sm:grid-cols-3 lg:grid-cols-4 lg:gap-2 xl:grid-cols-5">
        <button
            v-for="(foto, indice) in fotos"
            :key="foto.id_foto"
            type="button"
            class="relative aspect-square overflow-hidden rounded-[13px] bg-white/15"
            @click="$emit('abrir', indice)"
        >
            <img :src="foto.thumb" :alt="`Foto ${indice + 1} do evento`" class="h-full w-full object-cover" loading="lazy" />
            <!-- Selo só na primeira: repetir em todas transformaria a grade numa planilha. -->
            <span
                v-if="mostrarSelo && indice === 0 && foto.similaridade !== undefined"
                class="absolute right-1.5 top-1.5 rounded-full bg-black/70 px-2 py-0.5 text-[10px] font-bold"
            >
                {{ porcentagem(foto.similaridade) }}
            </span>
        </button>
    </div>
</template>
