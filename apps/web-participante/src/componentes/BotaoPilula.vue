<script setup lang="ts">
withDefaults(defineProps<{ variante?: "principal" | "secundaria"; desabilitado?: boolean }>(), {
    variante: "principal",
    desabilitado: false,
});
defineEmits<{ click: [] }>();
</script>

<template>
    <button
        type="button"
        :class="variante === 'principal' ? 'pilula' : 'pilula-vazada'"
        :disabled="desabilitado"
        @click="$emit('click')"
    >
        <slot />
    </button>
</template>
