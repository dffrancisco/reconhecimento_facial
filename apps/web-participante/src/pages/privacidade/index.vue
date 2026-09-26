<script setup lang="ts">
import { useRouter } from "vue-router";

// Termo versionado: a versão exibida aqui é a que a busca grava em `versao_termo`.
const VERSAO = "v1";

// Quem chega aqui veio do link "Termo" da câmera, na mesma aba: voltar é desfazer essa
// navegação. Aberta direto não há para onde voltar, e "/" cairia de novo nesta tela.
const router = useRouter();
const temDeOndeVoltar = Boolean(router.options.history.state.back);
</script>

<template>
    <main class="tela-largada px-5 py-8">
        <p class="rotulo">Privacidade · {{ VERSAO }}</p>
        <h1 class="titulo mt-2">Como cuidamos da sua selfie</h1>

        <section class="caixa mt-5 p-4 text-sm leading-relaxed">
            <p><b>Para que serve.</b> Sua selfie é usada só para encontrar as fotos em que você aparece neste evento.</p>
            <p class="mt-3"><b>Quanto tempo fica.</b> A selfie é apagada assim que a busca termina. Não guardamos o seu rosto.</p>
            <p class="mt-3"><b>O que guardamos.</b> Guardamos quais fotos foram encontradas para você, para poder mostrar de novo quando você voltar pelo link.</p>
            <p class="mt-3"><b>Como apagar.</b> Você pode pedir a exclusão dos seus dados a qualquer momento pelo contato do organizador do evento.</p>
        </section>

        <button v-if="temDeOndeVoltar" type="button" class="pilula-vazada mt-6" @click="router.back()">
            Voltar
        </button>
    </main>
</template>
