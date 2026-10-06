// Map PIORBS_XAI_API_KEY onto XAI_API_KEY for this process and its child.
// Never print, log, or persist either value.
if (process.env.PIORBS_XAI_API_KEY && !process.env.XAI_API_KEY) {
  process.env.XAI_API_KEY = process.env.PIORBS_XAI_API_KEY;
}

const [command, ...args] = process.argv.slice(2);
if (!command) {
  console.error("usage: node scripts/with-xai-env.mjs <command> [args...]");
  process.exit(1);
}

const { spawn } = await import("node:child_process");
const child = spawn(command, args, { stdio: "inherit", env: process.env });
child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 1);
});
