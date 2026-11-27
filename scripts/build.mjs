// Pack the authored files into a standalone Worker without a dependency install.
import {readFile,writeFile,mkdir,copyFile} from "node:fs/promises";
const root = new URL("../", import.meta.url);
const assets = {};
for (const [file,type] of Object.entries({"index.html":"text/html; charset=utf-8","app.js":"text/javascript; charset=utf-8","style.css":"text/css; charset=utf-8","icon.svg":"image/svg+xml","coast.jpg":"image/jpeg"})) {
  const bytes = await readFile(new URL("public/" + file,root));
  assets[file === "index.html" ? "/" : "/" + file] = {type,data:bytes.toString("base64")};
}
const backend = await readFile(new URL("server/relay.mjs",root),"utf8");
const handler = `
export default {
  fetch(request, env) {
    const path = new URL(request.url).pathname;
    if (path.startsWith("/api/")) return relay(request, env.BUCKET);
    const asset = assets[path];
    if (!asset) return new Response("找不到此页面。", {status:404});
    return new Response(Uint8Array.from(atob(asset.data), char => char.charCodeAt(0)), {
      headers: {"Content-Type":asset.type,"Referrer-Policy":"no-referrer","X-Content-Type-Options":"nosniff"}
    });
  }
};`;
await mkdir(new URL("dist/server/",root),{recursive:true});
await mkdir(new URL("dist/.openai/",root),{recursive:true});
await writeFile(new URL("dist/server/index.js",root),backend+"\nconst assets = "+JSON.stringify(assets)+";\n"+handler);
await copyFile(new URL(".openai/hosting.json",root),new URL("dist/.openai/hosting.json",root));
