<script setup lang="ts">
import { nextTick, onUnmounted, ref, watch } from "vue";
import { useRoute } from "vue-router";
import BotaoPilula from "../../componentes/BotaoPilula.vue";
import BotaoVoltar from "../../componentes/BotaoVoltar.vue";
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

// Clarão no oval a cada selfie que entra: a resposta ao toque de que a foto foi tirada.
const clarao = ref(false);
watch(
    () => state.selfies.length,
    (agora, antes) => {
        if (agora > antes) clarao.value = true;
    },
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
                    class="absolute inset-0 h-full w-full object-cover"
                    :class="{ '-scale-x-100': state.lado === 'user' }"
                ></video>

                <div class="absolute inset-0 flex flex-col">
                    <!-- relative z-10: o véu é a sombra do oval e passaria por cima do resto. -->
                    <header class="relative z-10 flex items-center justify-between px-3 pt-2">
                        <BotaoVoltar @click="actions.voltar()" />
                        <label class="flex min-h-11 items-center gap-2.5 pr-2 text-[0.95rem] font-semibold">
                            <input v-model="state.consentiu" type="checkbox" class="caixa-termos" />
                            <span>Aceito os <router-link to="/privacidade" class="underline underline-offset-4">termos</router-link></span>
                        </label>
                    </header>

                    <div class="pointer-events-none flex flex-1 items-center justify-center">
                        <div class="oval-selfie" :data-clarao="clarao || undefined" @animationend="clarao = false"></div>
                    </div>

                    <div class="relative z-10 flex flex-col items-center px-6 pb-5 text-center">
                        <p :key="state.selfies.length" class="contador-selfies" :class="{ 'contador-selfies-novo': state.selfies.length > 0 }" aria-live="polite">
                            {{ state.selfies.length }}
                        </p>
                        <!-- Sem o visto o disparo fica travado: a frase diz o que destrava. -->
                        <p class="mt-1.5 text-sm text-white/90">
                            {{ state.consentiu ? `Tire até ${state.maxSelfies} selfies para um resultado melhor` : "Marque “Aceito os termos” para começar" }}
                        </p>
                        <p v-if="state.mensagem" class="mt-1 text-xs text-white/85">{{ state.mensagem }}</p>
                        <button type="button" class="botao-rastrear mt-5" :disabled="!actions.podeRastrear()" @click="actions.buscar()">
                            Rastrear Foto
                        </button>
                    </div>
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

        <template v-else-if="state.etapa === 'semCamera'">
            <header class="barra-topo px-6">
                <BotaoVoltar @click="actions.voltar()" />
            </header>
            <section class="flex flex-1 flex-col justify-center px-6 pb-10">
                <p class="rotulo">Achar minhas fotos</p>
                <h1 class="titulo mt-2">{{ state.mensagem }}</h1>
                <label class="mt-4 flex items-start gap-2.5 text-sm leading-snug">
                    <input v-model="state.consentiu" type="checkbox" class="caixa-termos mt-px" />
                    <span>
                        Autorizo o uso da selfie para achar minhas fotos. Ela é apagada depois.
                        <router-link to="/privacidade" class="underline underline-offset-4">Termos</router-link>
                    </span>
                </label>
                <BotaoPilula class="mt-6" :desabilitado="!state.consentiu" @click="entradaArquivo?.click()">
                    Escolher da galeria
                </BotaoPilula>
            </section>
        </template>

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

        <template v-else-if="state.etapa === 'erro'">
            <header class="barra-topo px-6">
                <BotaoVoltar @click="actions.voltar()" />
            </header>
            <section class="flex flex-1 flex-col justify-center px-6 pb-10">
                <h1 class="titulo">{{ state.mensagem }}</h1>
                <BotaoPilula class="mt-6" @click="actions.tentarDeNovo()">Tentar outra selfie</BotaoPilula>
                <!-- Mesma selfie de novo: é o caminho de quem perdeu a conexão no meio da busca. -->
                <BotaoPilula class="mt-2" variante="secundaria" @click="actions.buscar()">Tentar de novo</BotaoPilula>
            </section>
        </template>

        <!-- Sem `capture`: no celular ele pula a galeria e abre a câmera, e este é o caminho
             de quem não pôde usar a câmera pelo navegador. -->
        <input ref="entradaArquivo" type="file" accept="image/*" multiple class="hidden" @change="aoEscolher" />
    </main>
</template>
