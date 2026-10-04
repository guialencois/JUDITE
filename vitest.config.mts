import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Testes das regras de negócio (limites, cálculos, decisões do Diretor). Rodar: npx vitest run
export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
