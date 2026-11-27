// Single-process local preview. The hosted Worker uses native R2 conditional puts.
import http from "node:http";
import { Readable } from "node:stream";
import { readFileSync, mkdirSync, writeFileSync, renameSync, unlinkSync } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { relay } from "./relay.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
export function diskBucket(directory) {
  const pathFor = key => resolve(directory, key);
  function read(key) {
    try { return readFileSync(pathFor(key)); }
    catch (e) { if (e.code === "ENOENT") return null; throw e; }
  }
  const etag = bytes => createHash("sha256").update(bytes).digest("hex");
  return {
    get(key) {
      const body = read(key);
      return body && { body, etag: etag(body), json: () => JSON.parse(body.toString("utf8")) };
    },
    put(key, value, options) {
      if (options?.onlyIf) {
        const previous = read(key);
        if (!previous || etag(previous) !== options.onlyIf.etagMatches) return null;
      }
      const path = pathFor(key);
      mkdirSync(dirname(path), {recursive:true});
      const tmp = path + "." + randomUUID();
      writeFileSync(tmp, value); renameSync(tmp, path);
      return {etag: etag(value)};
    },
    delete(key) { unlinkSync(pathFor(key)); }
  };
}
const types = {"/":"text/html; charset=utf-8", "/app.js":"text/javascript; charset=utf-8", "/style.css":"text/css; charset=utf-8", "/coast.jpg":"image/jpeg", "/icon.svg":"image/svg+xml"};
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const bucket = diskBucket(process.env.RELAY_DATA || resolve(root, ".data"));
  const host = process.env.HOST || "127.0.0.1";
  const port = Number(process.env.PORT || 4173);
  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, "http://" + req.headers.host);
      let response;
      if (url.pathname.startsWith("/api/")) {
        const init = {method:req.method, headers:req.headers};
        if (!["GET","HEAD"].includes(req.method)) Object.assign(init, {body:Readable.toWeb(req), duplex:"half"});
        response = await relay(new Request(url,init),bucket);
      } else if (Object.hasOwn(types, url.pathname)) {
        const file = url.pathname === "/" ? "index.html" : url.pathname.slice(1);
        response = new Response(readFileSync(resolve(root,"public",file)), {headers:{"content-type":types[url.pathname],"referrer-policy":"no-referrer"}});
      } else response = new Response("找不到此页面。", {status:404});
      res.writeHead(response.status, Object.fromEntries(response.headers));
      if (response.body) Readable.fromWeb(response.body).pipe(res); else res.end();
    } catch { res.writeHead(500); res.end("暂时无法打开，请重试。"); }
  });
  server.listen(port, host, () => console.log("合映 http://" + host + ":" + server.address().port));
}
