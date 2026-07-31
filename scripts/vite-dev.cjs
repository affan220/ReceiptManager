const { createServer } = require("vite");
const loadConfig = require("../vite.config.cjs");

async function main() {
  const config = typeof loadConfig === "function" ? loadConfig() : loadConfig;
  const server = await createServer({
    ...config,
    configFile: false,
    root: process.cwd(),
    logLevel: "info",
  });

  await server.listen();
  server.printUrls();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
