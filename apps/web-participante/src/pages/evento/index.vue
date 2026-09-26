<script setup lang="ts">
import { nextTick, onUnmounted, ref, watch } from "vue";
import { useRoute } from "vue-router";
import BotaoPilula from "../../componentes/BotaoPilula.vue";
import { actions, state } from "./evento";

const rota = useRoute();
const video = ref<HTMLVideoElement | null>(null);
const entradaArquivo = ref<HTMLInputElement | null>(null);

nextTick(() => actions.init());

// O fluxo da câmera chega depois do primeiro render: ligar no elemento quando existir.
watch([() => state.fluxo, video], () => {
    if (video.value && state.fluxo) video.value.srcObject = state.fluxo;
});

onUnmounted(() => actions.encerrarCamera());

function aoEscolher(evento: Event): void {
    const arquivos = Array.from((evento.target as HTMLInputElement).files ?? []);
    if (arquivos.length > 0) actions.escolherDaGaleria(arquivos);
}
</script>

<template>
    <main class="tela-largada flex flex-col">
        <template v-if="state.etapa === 'camera'">
            <div class="relative flex-1 overflow-hidden bg-[#17171c]">
                <!-- Câmera da frente espelhada, como o celular mostra: a foto enviada não é. -->
                <video
                    ref="video"
                    autoplay
                    playsinline
                    muted
                    class="h-full w-full object-cover opacity-80"
                    :class="{ '-scale-x-100': state.lado === 'user' }"
                ></video>
                <div
                    class="pointer-events-none absolute left-1/2 top-1/2 h-[54%] w-[62%] -translate-x-1/2 -translate-y-1/2 rounded-[50%] border-[3px] border-dashed border-white/90"
                ></div>

                <div class="absolute inset-x-3 bottom-4 rounded-[15px] bg-black/80 p-3 backdrop-blur">
                    <p class="text-sm font-extrabold">Encaixe seu rosto e toque</p>
                    <label class="mt-2 flex items-start gap-2 text-[10px] leading-snug">
                        <input v-model="state.consentiu" type="checkbox" class="mt-0.5 size-4 shrink-0 accent-white" />
                        <span>
                            Autorizo o uso da selfie para achar minhas fotos. Ela é apagada depois.
                            <router-link to="/privacidade" class="underline">Termo</router-link>
                        </span>
                    </label>
                </div>
            </div>

            <div class="flex items-center justify-between px-6 py-4">
                <button type="button" class="w-12 text-xs disabled:opacity-40" :disabled="!state.consentiu" @click="entradaArquivo?.click()">
                    Galeria
                </button>
                <button
                    type="button"
                    aria-label="Tirar selfie"
                    class="size-14 rounded-full border-4 border-white/40 bg-white disabled:opacity-40"
                    :disabled="!actions.podeDisparar()"
                    @click="video && actions.disparar(video)"
                ></button>
                <button type="button" class="w-12 text-xs" @click="actions.virarCamera()">Virar</button>
            </div>
        </template>

        <section v-else-if="state.etapa === 'semCamera'" class="flex flex-1 flex-col justify-center px-6 py-10">
            <p class="rotulo">Achar minhas fotos</p>
            <h1 class="titulo mt-2">{{ state.mensagem }}</h1>
            <label class="mt-3 flex items-start gap-2 text-xs leading-snug">
                <input v-model="state.consentiu" type="checkbox" class="mt-0.5 size-4 shrink-0 accent-white" />
                <span>
                    Autorizo o uso da selfie para achar minhas fotos. Ela é apagada depois.
                    <router-link to="/privacidade" class="underline">Termo</router-link>
                </span>
            </label>
            <BotaoPilula class="mt-6" :desabilitado="!state.consentiu" @click="entradaArquivo?.click()">
                Escolher da galeria
            </BotaoPilula>
        </section>

        <!-- Sem `capture`: no celular ele pula a galeria e abre a câmera, e este é o caminho
             de quem não pôde usar a câmera pelo navegador. -->
        <input ref="entradaArquivo" type="file" accept="image/*" multiple class="hidden" @change="aoEscolher" />
    </main>
</template>
