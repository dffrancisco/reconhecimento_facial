<script setup lang="ts">
import { ref, watch } from "vue";
import QRCode from "qrcode";

const props = withDefaults(defineProps<{ texto: string; tamanho?: number }>(), { tamanho: 26 });
const svg = ref("");

// SVG e não canvas: nítido em qualquer tamanho (o "QR grande" é para o celular ler de longe).
watch(
    () => props.texto,
    async (texto) => {
        svg.value = await QRCode.toString(texto, { type: "svg", margin: 1, errorCorrectionLevel: "M" });
    },
    { immediate: true }
);
</script>

<template>
    <span class="inline-block align-middle" :style="{ width: `${tamanho}px`, height: `${tamanho}px` }" role="img" :aria-label="`QR do link ${texto}`" v-html="svg"></span>
</template>
