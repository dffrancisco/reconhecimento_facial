<script setup lang="ts">
import { actions, state } from "../evento";

function escolherMarca(ev: Event): void {
    const arquivo = (ev.target as HTMLInputElement).files?.[0];
    if (arquivo) actions.enviarMarca(arquivo);
}
</script>

<template>
    <section v-if="state.evento && state.form" class="superficie mt-4 p-4" data-bloco="dados">
        <p class="rotulo-secao">Dados</p>
        <form data-form="dados" class="mt-2 grid gap-3 sm:grid-cols-2" @submit.prevent="actions.salvar()">
            <label class="block sm:col-span-2">
                <span class="apagado">Nome</span>
                <input v-model="state.form.nome" name="nome" class="campo mt-1" />
            </label>
            <p class="apagado sm:col-span-2">
                Endereço <b>{{ state.evento.slug }}</b> · {{ state.evento.tipo === "esportivo" ? "Esportivo" : "Social" }} — não mudam depois de
                criado, para não quebrar os links já distribuídos.
            </p>
            <label class="block">
                <span class="apagado">Início</span>
                <input v-model="state.form.data_inicio" type="date" name="data_inicio" class="campo mt-1" />
            </label>
            <label class="block">
                <span class="apagado">Fim</span>
                <input v-model="state.form.data_fim" type="date" name="data_fim" class="campo mt-1" />
            </label>
            <fieldset>
                <legend class="apagado">Acesso</legend>
                <label class="mr-4"><input v-model="state.form.privado" type="radio" name="acesso" :value="false" /> Público</label>
                <label><input v-model="state.form.privado" type="radio" name="acesso" :value="true" /> Privado</label>
            </fieldset>
            <label class="flex items-center gap-2"><input v-model="state.form.ativo" type="checkbox" name="ativo" /> Evento ativo</label>
            <label class="block sm:col-span-2">
                <span class="apagado">Organizador (o nome que o participante vê)</span>
                <input v-model="state.form.organizador" name="organizador" class="campo mt-1" />
            </label>
            <div class="sm:col-span-2">
                <label class="flex items-center gap-2"><input v-model="state.form.exigir_whatsapp" type="checkbox" name="exigir_whatsapp" /> Exigir WhatsApp</label>
                <p class="aviso mt-1 px-3 py-2">A verificação por WhatsApp ainda não existe: ligado, o participante não vê as fotos.</p>
            </div>
            <div class="sm:col-span-2">
                <label class="flex items-center gap-2"><input v-model="state.form.marca_dagua" type="checkbox" name="marca_dagua" /> Marca d'água nas fotos</label>
                <label class="mt-2 block">
                    <span class="apagado">Enviar PNG (até 2 MB) — vale para as fotos processadas depois do envio.</span>
                    <input type="file" name="marca" accept="image/png" class="mt-1 block" :disabled="state.enviandoMarca" @change="escolherMarca" />
                </label>
                <p v-if="state.mensagemMarca" class="mt-1 text-[var(--sucesso)]">{{ state.mensagemMarca }}</p>
                <p v-if="state.erroMarca" class="mt-1 text-[var(--erro)]">{{ state.erroMarca }}</p>
            </div>
            <details class="sm:col-span-2">
                <summary class="cursor-pointer font-bold">Avançado</summary>
                <div class="mt-2 grid gap-3 sm:grid-cols-2">
                    <label class="block">
                        <span class="apagado">Limiar de semelhança (0,20 a 0,80)</span>
                        <input v-model="state.form.limiar" type="number" step="0.01" min="0.2" max="0.8" name="limiar" class="campo mt-1" />
                    </label>
                    <label class="block">
                        <span class="apagado">Máximo de selfies (1 a 5)</span>
                        <input v-model="state.form.max_selfies" type="number" min="1" max="5" name="max_selfies" class="campo mt-1" />
                    </label>
                    <label class="block">
                        <span class="apagado">Dias até apagar o evento (1 a 3650)</span>
                        <input v-model="state.form.dias_expurgo" type="number" min="1" max="3650" name="dias_expurgo" class="campo mt-1" />
                    </label>
                    <label class="block">
                        <span class="apagado">Validade do resultado, em dias (vazio = sem validade)</span>
                        <input v-model="state.form.validade_resultado_dias" type="number" min="1" max="3650" name="validade_resultado_dias" class="campo mt-1" />
                    </label>
                </div>
            </details>
            <p v-if="state.erroDados" class="text-[var(--erro)] sm:col-span-2">{{ state.erroDados }}</p>
            <p v-if="state.mensagemDados" class="text-[var(--sucesso)] sm:col-span-2">{{ state.mensagemDados }}</p>
            <div class="sm:col-span-2">
                <button type="submit" class="botao" :disabled="state.salvando">Salvar</button>
            </div>
        </form>
    </section>
</template>
