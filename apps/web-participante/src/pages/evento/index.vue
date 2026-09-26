<script setup lang="ts">
import { nextTick, onUnmounted, ref, watch } from "vue";
import { useRoute } from "vue-router";
import BotaoPilula from "../../componentes/BotaoPilula.vue";
import { actions, state } from "./evento";

const rota = useRoute();
const video = ref<HTMLVideoElement | null>(null);
const entradaArquivo = ref<HTMLInputElement | null>(null);

nextTick(() => {
    state.slug = String(rota.params.slug ?? "");
    state.chaveAcesso = String(rota.params.chave ?? "");
    actions.init();
});

// O fluxo da câmera chega depois do primeiro render: ligar no elemento quando existir.
watch([() => state.fluxo, video], () => {
    if (video.value && state.fluxo) video.value.srcObject = state.fluxo;
});

// Um object URL por selfie mostrada, devolvido quando ela troca: criado no template, nasceria
// um novo a cada render e nenhum seria liberado.
const miniatura = ref("");
watch(
    () => state.selfies[0],
    (selfie) => {
        if (miniatura.value) URL.revokeObjectURL(miniatura.value);
        miniatura.value = selfie ? URL.createObjectURL(selfie) : "";
    },
    { immediate: true },
);

onUnmounted(() => {
    actions.encerrarCamera();
    if (miniatura.value) URL.revokeObjectURL(miniatura.value);
});

function aoEscolher(evento: Event): void {
    const entrada = evento.target as HTMLInputElement;
    const arquivos = Array.from(entrada.files ?? []);
    // Zerado para que escolher a mesma foto de novo (depois de um erro) dispare o change.
    entrada.value = "";
    if (arquivos.length > 0) actions.usarDaGaleria(arquivos);
}
</script>

<template>
    <main class="tela-largada flex flex-col">
        <template v-if="state.etapa === 'camera'">
            <div class="relative flex-1 overflow-hidden bg-[#17171c]">
                <!-- Câmera da frente espelhada, como o celular mostra: a foto enviada não é.
                     Absoluto porque a área só tem min-height: h-full sozinho não a preenche. -->
                <video
                    ref="video"
                    autoplay
                    playsinline
                    muted
                    class="absolute inset-0 h-full w-full object-cover opacity-80"
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

                    <template v-if="state.selfies.length > 0">
                        <BotaoPilula class="mt-3" @click="actions.buscar()">Buscar agora</BotaoPilula>
                        <p v-if="actions.podeDisparar()" class="mt-2 text-center text-[10px] text-white/75">
                            Ou toque de novo para adicionar outra ({{ state.selfies.length }} de {{ state.maxSelfies }})
                        </p>
                    </template>
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

        <section v-else-if="state.etapa === 'buscando'" class="flex flex-1 flex-col items-center justify-center px-6 text-center">
            <img
                v-if="miniatura"
                :src="miniatura"
                alt="Selfie que você enviou"
                class="size-20 rounded-2xl border-[3px] border-white/45 object-cover"
            />
            <h1 class="titulo mt-4">Procurando você</h1>
            <p class="mt-1 text-xs text-white/85">
                {{ state.totalFotos > 0 ? `Olhando ${state.totalFotos} fotos da prova` : "Olhando as fotos da prova" }}
            </p>
            <div class="mt-4 flex gap-1.5">
                <span class="size-[7px] animate-pulse rounded-full bg-white"></span>
                <span class="size-[7px] animate-pulse rounded-full bg-white/60 [animation-delay:150ms]"></span>
                <span class="size-[7px] animate-pulse rounded-full bg-white/40 [animation-delay:300ms]"></span>
            </div>
        </section>

        <section v-else-if="state.etapa === 'erro'" class="flex flex-1 flex-col justify-center px-6 py-10">
            <h1 class="titulo">{{ state.mensagem }}</h1>
            <BotaoPilula class="mt-6" @click="actions.tentarDeNovo()">Tentar outra selfie</BotaoPilula>
            <!-- Mesma selfie de novo: é o caminho de quem perdeu a conexão no meio da busca. -->
            <BotaoPilula class="mt-2" variante="secundaria" @click="actions.buscar()">Tentar de novo</BotaoPilula>
        </section>

        <!-- Sem `capture`: no celular ele pula a galeria e abre a câmera, e este é o caminho
             de quem não pôde usar a câmera pelo navegador. -->
        <input ref="entradaArquivo" type="file" accept="image/*" multiple class="hidden" @change="aoEscolher" />
    </main>
</template>
