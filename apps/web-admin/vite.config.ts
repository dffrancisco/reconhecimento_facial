import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import tailwind from "@tailwindcss/vite";

// Em produção a tela e a API ficam no domínio do admin, atrás do Traefik do VPS. O proxy
// reproduz isso no desenvolvimento, apontando para a API de dev no papel VPS.
export default defineConfig({
    plugins: [vue(), tailwind()],
    server: {
        port: 5175,
        proxy: {
            "/api": { target: "http://127.0.0.1:3002", changeOrigin: true },
        },
    },
});
