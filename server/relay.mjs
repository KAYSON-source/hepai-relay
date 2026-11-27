// One immutable blob per upload. A conditional manifest write publishes its version.
const MAX_BYTES = 24 * 1024 * 1024;
const LEASE_MS = 2 * 60 * 60 * 1000;
const ID = /^[a-f0-9]{32}$/;
const newId = () => crypto.randomUUID().replaceAll("-", "");
const hex = buffer => [...new Uint8Array(buffer)].map(n => n.toString(16).padStart(2, "0")).join("");

class RequestError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
function reject(status, message) { throw new RequestError(status, message); }
function json(data, status = 200) {
  return Response.json(data, { status, headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });
}
function field(request, header, limit) {
  try {
    const raw = decodeURIComponent(request.headers.get(header) || "");
    return raw.replace(/[\u0000-\u001f\u007f]/g,"").trim().slice(0, limit);
  } catch { reject(400, "文件信息有误，请重新选择照片。"); }
}
function mime(bytes) {
  const b = bytes;
  const str = (start, end) => String.fromCharCode(...b.slice(start, end));
  if (b[0] === 255 && b[1] === 216 && b[2] === 255) return "image/jpeg";
  if (str(0,8) === "\x89PNG\r\n\x1a\n") return "image/png";
  if (str(0,4) === "RIFF" && str(8,12) === "WEBP") return "image/webp";
  if (str(4,8) === "ftyp") {
    const brands = str(8, Math.min(b.length, 96));
    if (/heic|heix|hevc|hevx/.test(brands)) return "image/heic";
    if (/mif1|msf1/.test(brands)) return "image/heif";
  }
  reject(415, "请选择 JPG、PNG、HEIC、HEIF 或 WebP 照片。");
}
async function readPhoto(request) {
  const size = Number(request.headers.get("x-file-size"));
  if (!Number.isSafeInteger(size) || size < 1) reject(400, "请选择一张照片。");
  if (size > MAX_BYTES) reject(413, "每张照片最多支持 24 MB。");
  const reader = request.body?.getReader();
  if (!reader) reject(400, "没有收到照片，请重试。");
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (;;) {
    const {done, value} = await reader.read();
    if (done) break;
    if (offset + value.length > size) { await reader.cancel(); reject(400, "文件大小不匹配。"); }
    bytes.set(value, offset); offset += value.length;
  }
  if (offset !== size) reject(400, "上传未完成，请重新选择照片。");
  const type = mime(bytes);
  const filename = field(request, "x-file-name", 160).replace(/[\\/]/g,"_") || "合照";
  const sha256 = hex(await crypto.subtle.digest("SHA-256", bytes));
  return { bytes, info: { id: newId(), filename, size, type, sha256, time: Date.now() } };
}
function visible(room, participant) {
  const {lease, ...data} = room;
  return { ...data, lease: lease && lease.until > Date.now() ?
    { name: lease.name, until: lease.until, mine: lease.holder === participant } : null };
}
async function dispatch(request, bucket) {
  const url = new URL(request.url);
  const parts = url.pathname.split("/").filter(Boolean);
  if (parts[0] !== "api" || parts[1] !== "rooms") reject(404, "找不到此页面。");
  const [, , roomId, action, versionId] = parts;
  const rawToken = request.headers.get("x-participant") || "";
  const participant = ID.test(rawToken) ? hex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(rawToken))) : "";
  const isPost = request.method === "POST";
  if (isPost && !participant) reject(400, "请重新打开页面后再试。");
  if (isPost && request.headers.get("origin") && request.headers.get("origin") !== url.origin) reject(403, "请从接力页面操作。");
  const name = field(request, "x-nickname", 24) || "朋友";
  if (!roomId && isPost) {
    const photo = await readPhoto(request);
    const id = newId();
    const title = field(request, "x-room-title", 48) || "我们的合照";
    const room = { id, title, lease: null, versions: [{ ...photo.info, name }] };
    await bucket.put(id + "/" + photo.info.id, photo.bytes);
    await bucket.put(id + "/room", JSON.stringify(room));
    return json(visible(room, participant), 201);
  }
  if (!ID.test(roomId || "")) reject(404, "接力链接无效。");
  const key = roomId + "/room";
  const object = await bucket.get(key);
  if (!object) reject(404, "找不到这场接力，请检查邀请链接。");
  const room = await object.json();
  if (room.lease && room.lease.until <= Date.now()) room.lease = null;
  if (!action && request.method === "GET") return json(visible(room, participant));
  if (action === "files" && request.method === "GET") {
    const info = room.versions.find(v => v.id === versionId);
    if (!info) reject(404, "找不到这个版本。");
    const file = await bucket.get(roomId + "/" + info.id);
    if (!file) reject(503, "照片暂时无法读取，请稍后重试。");
    const disposition = url.searchParams.has("download") ? "attachment" : "inline";
    return new Response(file.body, { headers: {
      "Content-Type": info.type, "Content-Length": String(info.size), "Cache-Control":"private, no-store",
      "Content-Disposition": disposition + "; filename*=UTF-8''" + encodeURIComponent(info.filename).replace(/'/g,"%27"),
      "X-Content-Type-Options":"nosniff", "Referrer-Policy":"no-referrer"
    } });
  }
  if (!isPost || !["claim","release","versions"].includes(action)) reject(405, "此操作不可用。");
  if (room.lease && room.lease.holder !== participant) reject(409, room.lease.name + " 正在修图，等这一棒传回后再来。");
  let newFile;
  if (action === "claim") {
    room.lease = { holder: participant, name, until: Date.now() + LEASE_MS };
  } else {
    if (!room.lease) reject(409, "这一棒已结束，请重新接棒并核对最新版本。");
    if (action === "versions") {
      if (request.headers.get("x-base-version") !== room.versions.at(-1).id) reject(409, "已有更新版本，请用最新照片继续接力。");
      const photo = await readPhoto(request);
      newFile = roomId + "/" + photo.info.id;
      await bucket.put(newFile, photo.bytes);
      room.versions.push({ ...photo.info, name: room.lease.name });
    }
    room.lease = null;
  }
  const result = await bucket.put(key, JSON.stringify(room), { onlyIf: { etagMatches: object.etag } });
  if (!result) {
    if (newFile) await bucket.delete(newFile);
    reject(409, "接力状态刚刚更新，请刷新后重试。");
  }
  return json(visible(room, participant));
}
export async function relay(request, bucket) {
  try { return await dispatch(request, bucket); }
  catch (error) {
    if (!(error instanceof RequestError)) console.error("Relay storage request failed", error.name);
    return json({error: error instanceof RequestError ? error.message : "暂时无法读写照片，请稍后重试。"}, error.status || 503);
  }
}
