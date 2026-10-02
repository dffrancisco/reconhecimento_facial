<script setup lang="ts">
import { useRouter } from "vue-router";
import BotaoVoltar from "../../componentes/BotaoVoltar.vue";

// Termo versionado: a versão exibida aqui é a que a busca grava em `versao_termo`.
const VERSAO = "v1";

// Quem chega aqui veio do link "Termo" da câmera, na mesma aba: voltar é desfazer essa
// navegação. Aberta direto não há para onde voltar, e "/" cairia de novo nesta tela.
const router = useRouter();
const temDeOndeVoltar = Boolean(router.options.history.state.back);
</script>

<template>
    <main class="tela-largada px-5 pb-8" :class="{ 'pt-8': !temDeOndeVoltar }">
        <header v-if="temDeOndeVoltar" class="barra-topo">
            <BotaoVoltar @click="router.back()" />
        </header>
        <p class="rotulo">Privacidade · {{ VERSAO }}</p>
        <h1 class="titulo mt-2">Como cuidamos da sua selfie</h1>

        <!-- Rascunho: precisa de revisão jurídica antes do primeiro evento (plataforma §10). -->
        <section class="caixa mt-5 p-4 text-sm leading-relaxed">
            <p><b>Para que serve.</b> Sua selfie é usada só para encontrar as fotos em que você aparece neste evento.</p>
            <p class="mt-3">
                <b>A selfie.</b> É apagada assim que a busca termina. O que calculamos dela para comparar também não é guardado.
            </p>
            <p class="mt-3">
                <b>Selfie lembrada no aparelho.</b> Para você não precisar tirar outra selfie ao voltar, uma cópia reduzida
                dela pode ficar guardada <b>somente no seu aparelho</b>. Ela nunca volta para nossos servidores; tirar uma
                nova selfie substitui a anterior, e limpar os dados do navegador a apaga.
            </p>
            <p class="mt-3">
                <b>O que guardamos.</b> Para a busca funcionar, guardamos as fotos e os rostos que aparecem nas fotos do evento.
                Da sua busca, guardamos quais fotos foram encontradas, para mostrar de novo quando você voltar pelo link.
            </p>
            <p class="mt-3">
                <b>Por quanto tempo.</b> Tudo isso é apagado automaticamente depois do evento, no prazo definido pela organização —
                em geral, 90 dias depois do fim.
            </p>
            <p class="mt-3">
                <b>Uso indevido.</b> Alguém pode tentar buscar com a foto de outra pessoa. Limitamos isso (há um limite de buscas
                por aparelho e as buscas ficam registradas), mas não dá para impedir totalmente.
            </p>
            <p class="mt-3">
                <b>Como apagar e contato.</b> Você pode pedir a exclusão dos seus dados a qualquer momento à organização do evento,
                que é também o contato para dúvidas sobre este termo.
            </p>
        </section>

    </main>
</template>
