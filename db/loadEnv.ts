import dotenv from "dotenv";
import path from "node:path";

// Localmente reaproveita o .env da API; no container as variáveis vêm do compose.
dotenv.config({ path: path.join(__dirname, "..", "apps", "api", ".env"), quiet: true });
