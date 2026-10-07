<script setup lang="ts">
import { computed, nextTick } from "vue";
import Cabecalho from "../../componentes/Cabecalho.vue";
import { actions, state } from "./usuarios";

nextTick(() => actions.init());

// A data em que o cadastro nasceu, no fuso do computador de quem olha.
const dia = (instante: string) => new Date(instante).toLocaleDateString("pt-BR");

const formulario = computed(() => (state.janela && state.janela.tipo !== "excluir" ? state.janela : null));
const minhaSenha = computed(() => formulario.value?.tipo === "senha" && actions.ehVoce(formulario.value.usuario));

const titulo = computed(() => {
    const janela = formulario.value;
    if (!janela) return "";
    if (janela.tipo === "novo") return "Novo usuário";
    if (janela.tipo === "alterar") return `Alterar ${janela.usuario.nome}`;
    return minhaSenha.value ? "Trocar a sua senha" : `Trocar a senha de ${janela.usuario.nome}`;
});

const rotuloSalvar = computed(() => ({ novo: "Criar", alterar: "Salvar", senha: "Trocar" })[formulario.value?.tipo ?? "novo"]);
</script>

<template>
    <main class="pagina">
        <Cabecalho />
        <div class="mx-auto max-w-5xl p-4">
            <div class="flex flex-wrap items-center justify-between gap-2">
                <h1 class="text-lg font-extrabold">Usuários</h1>
                <button type="button" class="botao" data-acao="novo-usuario" @click="actions.abrirNovo()">Novo usuário</button>
            </div>

            <p v-if="state.carregando" class="apagado mt-4">Carregando…</p>
            <p v-else-if="state.erro" class="mt-4 text-[var(--erro)]">{{ state.erro }}</p>
            <div v-else class="superficie mt-4 overflow-x-auto">
                <table class="w-full">
                    <thead>
                        <tr class="rotulo-secao text-left">
                            <th class="px-3 py-2">Nome</th>
                            <th class="px-3 py-2">Login</th>
                            <th class="px-3 py-2">Criado em</th>
                            <th class="px-3 py-2"></th>
                        </tr>
                    </thead>
                    <tbody>
                        <tr v-for="u in state.usuarios" :key="u.id_operador" :data-usuario="u.id_operador" class="border-t border-[#ececf0]">
                            <td class="px-3 py-2 font-bold">
                                {{ u.nome }} <span v-if="actions.ehVoce(u)" class="apagado font-normal">(você)</span>
                            </td>
                            <td class="px-3 py-2">{{ u.login }}</td>
                            <td class="px-3 py-2">{{ dia(u.criado_em) }}</td>
                            <td class="px-3 py-2">
                                <div class="flex justify-end gap-2">
                                    <button type="button" class="botao-secundario" :data-acao="`alterar-${u.id_operador}`" @click="actions.abrirAlterar(u)">
                                        Alterar
                                    </button>
                                    <button type="button" class="botao-secundario" :data-acao="`senha-${u.id_operador}`" @click="actions.abrirSenha(u)">
                                        Senha
                                    </button>
                                    <!-- Sem excluir na própria linha: quem está logado não se tira do admin. -->
                                    <button
                                        v-if="!actions.ehVoce(u)"
                                        type="button"
                                        class="botao-perigo"
                                        :data-acao="`excluir-${u.id_operador}`"
                                        @click="actions.abrirExclusao(u)"
                                    >
                                        Excluir
                                    </button>
                                </div>
                            </td>
                        </tr>
                    </tbody>
                </table>
            </div>
        </div>

        <div v-if="formulario" class="modal modal-open">
            <form class="modal-box" @submit.prevent="actions.salvar()">
                <p class="font-extrabold">{{ titulo }}</p>

                <div class="mt-3 grid gap-3">
                    <template v-if="formulario.tipo !== 'senha'">
                        <label class="block">
                            <span class="apagado">Nome</span>
                            <input v-model="state.form.nome" name="nome" class="campo mt-1" autocomplete="off" />
                        </label>
                        <label class="block">
                            <span class="apagado">Login</span>
                            <input v-model="state.form.login" name="login" class="campo mt-1" autocomplete="off" autocapitalize="none" spellcheck="false" />
                            <span class="apagado mt-1 block text-[11px]">Letras minúsculas, números, ponto, hífen ou sublinhado.</span>
                        </label>
                    </template>
                    <template v-if="formulario.tipo !== 'alterar'">
                        <label class="block">
                            <span class="apagado">{{ formulario.tipo === "senha" ? "Nova senha" : "Senha" }}</span>
                            <input v-model="state.form.senha" type="password" name="senha" class="campo mt-1" autocomplete="new-password" />
                            <span class="apagado mt-1 block text-[11px]">Pelo menos 8 caracteres.</span>
                        </label>
                        <label class="block">
                            <span class="apagado">{{ formulario.tipo === "senha" ? "Confirmar a senha" : "Confirmar senha" }}</span>
                            <input v-model="state.form.confirmacao" type="password" name="confirmacao" class="campo mt-1" autocomplete="new-password" />
                        </label>
                    </template>
                </div>

                <p v-if="formulario.tipo === 'senha'" class="aviso mt-3 px-3 py-2">
                    {{
                        minhaSenha
                            ? "Você continua conectado neste navegador; nos outros, precisa entrar de novo."
                            : "As sessões abertas dele com a senha antiga param de valer."
                    }}
                </p>
                <p v-if="state.erroJanela" class="mt-3 text-[var(--erro)]">{{ state.erroJanela }}</p>

                <div class="modal-action">
                    <button type="button" class="botao-secundario" data-acao="cancelar" @click="actions.fechar()">Cancelar</button>
                    <button type="submit" class="botao" data-acao="salvar" :disabled="state.ocupado">{{ rotuloSalvar }}</button>
                </div>
            </form>
        </div>

        <div v-if="state.janela?.tipo === 'excluir'" class="modal modal-open">
            <div class="modal-box">
                <p class="font-extrabold">Excluir {{ state.janela.usuario.nome }}?</p>
                <p class="mt-2">Ele perde o acesso ao admin na hora e ao painel da estação em até 1 minuto.</p>
                <p v-if="state.erroJanela" class="mt-3 text-[var(--erro)]">{{ state.erroJanela }}</p>
                <div class="modal-action">
                    <button type="button" class="botao-secundario" data-acao="cancelar" @click="actions.fechar()">Cancelar</button>
                    <button type="button" class="botao-perigo" data-acao="confirmar-exclusao" :disabled="state.ocupado" @click="actions.confirmarExclusao()">
                        Excluir
                    </button>
                </div>
            </div>
        </div>
    </main>
</template>
