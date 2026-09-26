import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import tailwind from "@tailwindcss/vite";

// Em produção a tela e a API ficam na mesma origem, atrás do Traefik da estação. O proxy
// reproduz isso no desenvolvimento, apontando para a API de dev no papel estação.
export default defineConfig({
    plugins: [vue(), tailwind()],
    server: {
        host: true,
        port: 5174,
        proxy: {
            "/api": { target: "http://127.0.0.1:3001", changeOrigin: true },
        },
    },
});
