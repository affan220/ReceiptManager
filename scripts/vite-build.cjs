const { build } = require("vite");
const loadConfig = require("../vite.config.cjs");

async function main() {
  const config = typeof loadConfig === "function" ? loadConfig() : loadConfig;
  const modeFlag = process.argv.indexOf("--mode");
  const mode = modeFlag >= 0 ? process.argv[modeFlag + 1] : undefined;
  await build({
    ...config,
    configFile: false,
    root: process.cwd(),
    ...(mode ? { mode } : {}),
  });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
