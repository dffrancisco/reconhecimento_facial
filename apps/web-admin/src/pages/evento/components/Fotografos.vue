<script setup lang="ts">
import { computed } from "vue";
import { actions, state } from "../evento";

const disponiveis = computed(() => state.fotografos.filter((f) => !state.vinculos.some((v) => v.id_fotografo === f.id_fotografo)));
</script>

<template>
    <section v-if="state.evento" class="superficie mt-4 p-4" data-bloco="fotografos">
        <p class="rotulo-secao">Fotógrafos</p>
        <p class="aviso mt-2 px-3 py-2">O link e o QR de upload de cada fotógrafo aparecem no painel da estação.</p>

        <p v-if="state.vinculos.length === 0" class="apagado mt-3">Nenhum fotógrafo neste evento ainda.</p>
        <ul v-else class="mt-3">
            <li v-for="v in state.vinculos" :key="v.id_evento_fotografo" class="flex flex-wrap items-center justify-between gap-2 border-t border-[#ececf0] py-2 first:border-t-0">
                <span>{{ v.nome }} <span v-if="v.telefone" class="apagado">· {{ v.telefone }}</span></span>
                <button type="button" class="botao-perigo" :data-acao="`remover-${v.id_evento_fotografo}`" @click="actions.pedirRemocao(v)">Remover do evento</button>
            </li>
        </ul>

        <div class="mt-4 grid gap-4 sm:grid-cols-2">
            <div>
                <p class="font-bold">Adicionar um já cadastrado</p>
                <div class="mt-1 flex gap-2">
                    <select v-model="state.idParaAdicionar" name="fotografo" class="campo">
                        <option :value="0" disabled>Escolha o fotógrafo…</option>
                        <option v-for="f in disponiveis" :key="f.id_fotografo" :value="f.id_fotografo">{{ f.nome }}{{ f.telefone ? ` · ${f.telefone}` : "" }}</option>
                    </select>
                    <button type="button" class="botao" data-acao="adicionar" :disabled="state.ocupadoFotografos || !state.idParaAdicionar" @click="actions.adicionar()">
                        Adicionar
                    </button>
                </div>
            </div>
            <div>
                <p class="font-bold">Cadastrar novo</p>
                <input v-model="state.novoNome" name="novo_nome" placeholder="Nome" class="campo mt-1" />
                <input v-model="state.novoTelefone" name="novo_telefone" placeholder="Telefone (opcional)" class="campo mt-2" />
                <button type="button" class="botao-secundario mt-2" data-acao="cadastrar" :disabled="state.ocupadoFotografos" @click="actions.cadastrarEAdicionar()">
                    Cadastrar e adicionar
                </button>
            </div>
        </div>

        <p v-if="state.erroFotografos" class="mt-3 text-[var(--erro)]">{{ state.erroFotografos }}</p>

        <div v-if="state.removendo" class="modal modal-open">
            <div class="modal-box">
                <p class="font-extrabold">Remover {{ state.removendo.nome }} do evento?</p>
                <p class="mt-2">O link de upload dele para de aceitar fotos. As fotos já enviadas continuam.</p>
                <div class="modal-action">
                    <button type="button" class="botao-secundario" data-acao="cancelar-remocao" @click="actions.cancelarRemocao()">Cancelar</button>
                    <button type="button" class="botao-perigo" data-acao="confirmar-remocao" @click="actions.confirmarRemocao()">Remover</button>
                </div>
            </div>
        </div>
    </section>
</template>
