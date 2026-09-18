import dotenv from "dotenv";
import path from "node:path";

// Em container as variáveis vêm do compose; o apps/api/.env só existe no desenvolvimento.
dotenv.config({ path: path.join(__dirname, "..", ".env"), quiet: true });
