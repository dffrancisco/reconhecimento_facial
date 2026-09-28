<script setup lang="ts">
import { useRouter } from "vue-router";
import { actions, state } from "./entrar";

const roteador = useRouter();
actions.init();

async function entrar(): Promise<void> {
    if (await actions.entrar()) await roteador.replace("/");
}
</script>

<template>
    <main class="pagina flex items-start justify-center p-4">
        <form class="superficie mt-16 w-full max-w-sm p-6" @submit.prevent="entrar">
            <p><span class="selo mr-2"></span><b>Admin</b></p>
            <h1 class="mt-3 text-lg font-extrabold">Entrar</h1>
            <label class="mt-4 block">
                <span class="apagado">Login</span>
                <input v-model="state.usuario" name="login" autocomplete="username" class="campo mt-1" />
            </label>
            <label class="mt-3 block">
                <span class="apagado">Senha</span>
                <input v-model="state.senha" name="senha" type="password" autocomplete="current-password" class="campo mt-1" />
            </label>
            <p v-if="state.erro" class="mt-3 text-[var(--erro)]">{{ state.erro }}</p>
            <button type="submit" class="botao mt-4 w-full" :disabled="state.entrando">Entrar</button>
        </form>
    </main>
</template>
