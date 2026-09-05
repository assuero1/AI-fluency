import { createServer } from "vite";
import path from "node:path";
import { tmpdir } from "node:os";

const root = process.cwd();
const server = await createServer({
  configFile: false,
  oxc: { jsx: { runtime: "automatic" } },
  root: path.join(root, "tests/browser"),
  cacheDir: path.join(tmpdir(), "ai-fluency-audio-vite"),
  resolve: { alias: { "@": root } },
  server: { host: "127.0.0.1", port: 3018, strictPort: true, fs: { allow: [root] } },
  optimizeDeps: { include: ["react", "react-dom/client", "lucide-react"] }
});
await server.listen();
server.printUrls();
