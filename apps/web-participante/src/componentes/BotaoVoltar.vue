<script setup lang="ts">
// "livre": só a seta, sobre o degradê ou a câmera. "vidro": quadrado cinza a 50%, por
// cima das fotos, onde a seta sozinha sumiria numa foto clara.
withDefaults(defineProps<{ variante?: "livre" | "vidro" }>(), { variante: "livre" });
defineEmits<{ click: [] }>();
</script>

<template>
    <button
        type="button"
        aria-label="Voltar"
        class="botao-voltar"
        :class="{ 'botao-voltar-vidro': variante === 'vidro' }"
        @click="$emit('click')"
    >
        <svg viewBox="0 0 24 24" class="size-6" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M20 12H4.5M11 5l-7 7 7 7" />
        </svg>
    </button>
</template>
