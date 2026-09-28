<script setup lang="ts">
import { useRouter } from "vue-router";
import Cabecalho from "../../componentes/Cabecalho.vue";
import { actions, state } from "./novo-evento";

const roteador = useRouter();
actions.init();

const texto = (ev: Event) => (ev.target as HTMLInputElement).value;

async function criar(): Promise<void> {
    const id = await actions.criar();
    if (id !== null) await roteador.push(`/eventos/${id}`);
}
</script>

<template>
    <main class="pagina">
        <Cabecalho />
        <div class="mx-auto max-w-2xl p-4">
            <h1 class="text-lg font-extrabold">Novo evento</h1>
            <form class="superficie mt-3 grid gap-3 p-4 sm:grid-cols-2" @submit.prevent="criar">
                <label class="block sm:col-span-2">
                    <span class="apagado">Nome</span>
                    <input name="nome" class="campo mt-1" :value="state.form.nome" @input="actions.mudarNome(texto($event))" />
                </label>
                <label class="block sm:col-span-2">
                    <span class="apagado">Endereço</span>
                    <input
                        name="endereco"
                        class="campo mt-1"
                        :value="state.form.slug"
                        @input="actions.editarEndereco(texto($event))"
                        @change="actions.arrumarEndereco()"
                    />
                    <span class="apagado mt-1 block">Vai no link do participante quando o evento é público.</span>
                </label>
                <fieldset>
                    <legend class="apagado">Tipo</legend>
                    <label class="mr-4"><input type="radio" name="tipo" value="esportivo" :checked="state.form.tipo === 'esportivo'" @change="actions.mudarTipo('esportivo')" /> Esportivo</label>
                    <label><input type="radio" name="tipo" value="social" :checked="state.form.tipo === 'social'" @change="actions.mudarTipo('social')" /> Social</label>
                </fieldset>
                <fieldset>
                    <legend class="apagado">Acesso</legend>
                    <label class="mr-4"><input type="radio" name="acesso" value="publico" :checked="!state.form.privado" @change="actions.mudarAcesso(false)" /> Público</label>
                    <label><input type="radio" name="acesso" value="privado" :checked="state.form.privado" @change="actions.mudarAcesso(true)" /> Privado</label>
                </fieldset>
                <label class="block">
                    <span class="apagado">Início</span>
                    <input v-model="state.form.data_inicio" type="date" name="data_inicio" class="campo mt-1" />
                </label>
                <label class="block">
                    <span class="apagado">Fim</span>
                    <input v-model="state.form.data_fim" type="date" name="data_fim" class="campo mt-1" />
                </label>
                <div class="sm:col-span-2">
                    <label class="flex items-center gap-2"><input v-model="state.form.exigir_whatsapp" type="checkbox" name="exigir_whatsapp" /> Exigir WhatsApp</label>
                    <p class="aviso mt-1 px-3 py-2">A verificação por WhatsApp ainda não existe: ligado, o participante não vê as fotos.</p>
                </div>
                <p v-if="state.erro" class="text-[var(--erro)] sm:col-span-2">{{ state.erro }}</p>
                <div class="flex gap-2 sm:col-span-2">
                    <button type="submit" class="botao" :disabled="state.salvando">Criar evento</button>
                    <RouterLink to="/" class="botao-secundario">Cancelar</RouterLink>
                </div>
            </form>
        </div>
    </main>
</template>
