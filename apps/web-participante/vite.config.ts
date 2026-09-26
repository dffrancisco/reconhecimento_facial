import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import tailwind from "@tailwindcss/vite";

// O proxy põe API e arquivos na mesma origem do app: sem isso a câmera (que exige
// contexto seguro) e os links assinados ficariam em origens diferentes no desenvolvimento.
export default defineConfig({
    plugins: [vue(), tailwind()],
    server: {
        host: true, // abre para a rede local: é assim que se testa no celular de verdade
        port: 5173,
        proxy: {
            "/api": { target: "http://127.0.0.1:3002", changeOrigin: true },
            "/arquivos": { target: "http://127.0.0.1:8080", changeOrigin: true },
        },
    },
});
