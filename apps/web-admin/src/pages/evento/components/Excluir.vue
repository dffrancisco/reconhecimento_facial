<script setup lang="ts">
import { computed } from "vue";
import { useRouter } from "vue-router";
import { actions, state } from "../evento";

const roteador = useRouter();

const fotos = computed(() => {
    const qtd = state.evento?.qtd_fotos ?? 0;
    if (qtd === 0) return "as fotos do site e os originais dos fotógrafos";
    return `${qtd === 1 ? "a foto" : `as ${qtd.toLocaleString("pt-BR")} fotos`} do site e os originais dos fotógrafos`;
});

async function excluir(): Promise<void> {
    if (await actions.excluir()) await roteador.push({ path: "/", query: { excluido: "1" } });
}
</script>

<template>
    <section v-if="state.evento" class="superficie mt-4 border-[#fecaca] p-4" data-bloco="excluir">
        <p class="rotulo-secao">Excluir evento</p>
        <div class="mt-2 flex flex-wrap items-center justify-between gap-3">
            <p>Apaga o evento e todas as fotos, no site e na estação. <b>Não dá para desfazer.</b></p>
            <button type="button" class="botao-perigo" data-acao="excluir-evento" @click="actions.abrirExclusao()">Excluir evento…</button>
        </div>

        <div v-if="state.excluindo" class="modal modal-open">
            <form class="modal-box" @submit.prevent="excluir">
                <p class="font-extrabold">Excluir {{ state.evento.nome }} para sempre?</p>
                <p class="mt-3">Some tudo deste evento:</p>
                <ul class="mt-1 list-disc pl-5">
                    <li>{{ fotos }}</li>
                    <li>as buscas, os resultados e os ZIPs dos participantes</li>
                    <li>a marca d'água e os links de upload</li>
                </ul>
                <p class="mt-3 rounded-[10px] border border-[#fecaca] bg-[#fef2f2] px-3 py-2 text-[#b91c1c]">
                    <b>Não dá para desfazer.</b> As fotos não podem ser recuperadas. Se o evento estiver acontecendo, os fotógrafos param de conseguir enviar.
                </p>
                <label class="mt-3 block">
                    <span>Para confirmar, digite o nome do evento: <b>{{ state.evento.nome }}</b></span>
                    <input v-model="state.nomeConfirmacao" name="confirmacao" class="campo mt-1" autocomplete="off" spellcheck="false" />
                </label>
                <p v-if="state.erroExclusao" class="mt-3 text-[var(--erro)]">{{ state.erroExclusao }}</p>
                <div class="modal-action">
                    <button type="button" class="botao-secundario" data-acao="cancelar-exclusao" :disabled="state.ocupadoExclusao" @click="actions.cancelarExclusao()">
                        Cancelar
                    </button>
                    <!-- type="button" com o próprio clique: o Enter no campo (único da janela) envia o form. -->
                    <button type="button" class="botao-perigo" data-acao="confirmar-exclusao" :disabled="!actions.nomeConfere() || state.ocupadoExclusao" @click="excluir">
                        {{ state.ocupadoExclusao ? "Excluindo…" : "Excluir para sempre" }}
                    </button>
                </div>
            </form>
        </div>
    </section>
</template>
