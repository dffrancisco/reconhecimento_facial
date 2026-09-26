<script setup lang="ts">
import type { Patrocinador } from "./interfaces";

// Fundo branco: logo colorido sobre o gradiente fica ilegível (spec do app, §2).
// O comentário mora aqui e não no template: lá ele viraria um segundo nó raiz, e a faixa
// deixaria de sumir por inteiro com a lista vazia.
defineProps<{ patrocinadores: Patrocinador[] }>();
</script>

<template>
    <div v-if="patrocinadores.length > 0" class="mt-6 flex flex-wrap items-center justify-center gap-4 rounded-xl bg-white px-4 py-3">
        <component
            :is="p.site ? 'a' : 'span'"
            v-for="p in patrocinadores"
            :key="p.nome"
            :href="p.site"
            target="_blank"
            rel="noopener noreferrer"
        >
            <img :src="p.logo" :alt="p.nome" class="h-7 w-auto object-contain" />
        </component>
    </div>
</template>
