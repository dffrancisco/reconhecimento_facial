<script setup lang="ts">
import { nextTick } from "vue";
import { useRouter } from "vue-router";
import Cabecalho from "../../componentes/Cabecalho.vue";
import { periodo } from "../../ts/datas";
import { actions, state } from "./eventos";

const roteador = useRouter();
nextTick(() => actions.init());
</script>

<template>
    <main class="pagina">
        <Cabecalho />
        <div class="mx-auto max-w-5xl p-4">
            <div class="flex flex-wrap items-center justify-between gap-2">
                <h1 class="text-lg font-extrabold">Eventos</h1>
                <RouterLink to="/eventos/novo" class="botao" data-acao="novo-evento">Novo evento</RouterLink>
            </div>

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
