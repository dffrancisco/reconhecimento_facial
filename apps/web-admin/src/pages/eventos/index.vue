<script setup lang="ts">
import { nextTick, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import Cabecalho from "../../componentes/Cabecalho.vue";
import { periodo } from "../../ts/datas";
import { actions, state } from "./eventos";

const roteador = useRouter();
const rota = useRoute();
nextTick(() => actions.init());

// Vindo da exclusão de um evento: o aviso aparece uma vez, e o endereço volta a ser só "/",
// para recarregar a página não avisar de novo.
const excluido = ref(rota.query.excluido === "1");
if (excluido.value) roteador.replace({ query: {} });
</script>

<template>
    <main class="pagina">
        <Cabecalho />
        <div class="mx-auto max-w-5xl p-4">
            <div class="flex flex-wrap items-center justify-between gap-2">
                <h1 class="text-lg font-extrabold">Eventos</h1>
                <RouterLink to="/eventos/novo" class="botao" data-acao="novo-evento">Novo evento</RouterLink>
            </div>
            <p v-if="excluido" class="superficie mt-4 px-3 py-2 text-[var(--sucesso)]" data-aviso="excluido">Evento excluído.</p>

            <p v-if="state.carregando" class="apagado mt-4">Carregando…</p>
            <p v-else-if="state.erro" class="mt-4 text-[var(--erro)]">{{ state.erro }}</p>
            <p v-else-if="state.eventos.length === 0" class="superficie mt-4 p-6 text-center">Nenhum evento ainda. Crie o primeiro.</p>
            <div v-else class="superficie mt-4 overflow-x-auto">
                <table class="w-full">
                    <thead>
                        <tr class="rotulo-secao text-left">
                            <th class="px-3 py-2">Evento</th>
                            <th class="px-3 py-2">Período</th>
                            <th class="px-3 py-2">Tipo</th>
                            <th class="px-3 py-2">Acesso</th>
                            <th class="px-3 py-2">Situação</th>
                        </tr>
                    </thead>
                    <tbody>
                        <tr
                            v-for="e in state.eventos"
                            :key="e.id_evento"
                            :data-evento="e.id_evento"
                            class="cursor-pointer border-t border-[#ececf0] hover:bg-[var(--fundo)]"
                            @click="roteador.push(`/eventos/${e.id_evento}`)"
                        >
                            <td class="px-3 py-2 font-bold">{{ e.nome }}</td>
                            <td class="px-3 py-2">{{ periodo(e.data_inicio, e.data_fim) }}</td>
                            <td class="px-3 py-2">{{ e.tipo === "esportivo" ? "Esportivo" : "Social" }}</td>
                            <td class="px-3 py-2">{{ e.privado === "S" ? "Privado" : "Público" }}</td>
                            <td class="px-3 py-2" :class="e.ativo === 'S' ? 'text-[var(--sucesso)]' : 'apagado'">{{ e.ativo === "S" ? "Ativo" : "Inativo" }}</td>
                        </tr>
                    </tbody>
                </table>
            </div>
        </div>
    </main>
</template>
