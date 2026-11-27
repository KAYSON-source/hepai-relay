import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { relay } from "../server/relay.mjs";
import { diskBucket } from "../server/local.mjs";

const photo=await readFile(new URL("../public/coast.jpg",import.meta.url));
const hash=data=>createHash("sha256").update(data).digest("hex");
const alice="a".repeat(32),bob="b".repeat(32);
async function setup(t){
  const dir=await mkdtemp(join(tmpdir(),"hepai-test-"));
  t.after(()=>rm(dir,{recursive:true,force:true}));
  const bucket=diskBucket(dir);
  const call=(path="",method="GET",who=alice,bytes,fields={})=>relay(new Request("https://test.local/api/rooms"+path,{
    method,body:bytes,headers:{"x-participant":who,...(bytes?{"x-file-size":String(bytes.length),"x-file-name":encodeURIComponent("海边 合照.jpg")} : {}),...fields}
  }),bucket);
  const response=await call("","POST",alice,photo,{"x-room-title":encodeURIComponent("周末")});
  assert.equal(response.status,201);
  const room=await response.json();
  return {room,path:"/"+room.id,call,bucket,dir};
}
test("two people can pass the photo and download every version byte for byte",async t=>{
  const {room,path,call}=await setup(t);const original=room.versions[0];
  assert.equal(original.sha256,hash(photo));
  const firstFile=await call(path+"/files/"+original.id+"?download","GET",bob);
  assert.match(firstFile.headers.get("content-disposition"),/^attachment/);
  assert.deepEqual(Buffer.from(await firstFile.arrayBuffer()),photo);
  assert.equal((await call(path+"/claim","POST",bob)).status,200);
  assert.equal((await (await call(path,"GET",alice)).json()).lease.mine,false);
  assert.equal((await call(path+"/claim","POST",alice)).status,409);
  const changed=Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jWZkAAAAASUVORK5CYII=","base64");
  const submit=(who,base)=>call(path+"/versions","POST",who,changed,{"x-base-version":base});
  assert.equal((await submit(alice,original.id)).status,409);
  assert.equal((await submit(bob,"stale")).status,409);
  const sent=await submit(bob,original.id);assert.equal(sent.status,200);
  const next=await sent.json();assert.equal(next.lease,null);assert.equal(next.versions.length,2);
  assert.equal(next.versions[1].sha256,hash(changed));
  assert.deepEqual(Buffer.from(await (await call(path+"/files/"+next.versions[1].id)).arrayBuffer()),changed);
  assert.deepEqual(Buffer.from(await (await call(path+"/files/"+original.id)).arrayBuffer()),photo);
  assert.equal((await submit(bob,original.id)).status,409);
  assert.equal((await call(path+"/claim","POST",alice)).status,200);
  assert.equal((await call(path+"/release","POST",alice)).status,200);
});
test("at most one editor wins a simultaneous claim or upload",async t=>{
  const {room,path,call}=await setup(t);
  const claims=await Promise.all([alice,bob].map(who=>call(path+"/claim","POST",who)));
  assert.deepEqual(claims.map(r=>r.status).sort(),[200,409]);
  const who=claims[0].ok?alice:bob;
  const sends=await Promise.all([0,1].map(()=>call(path+"/versions","POST",who,photo,{"x-base-version":room.versions[0].id})));
  assert.deepEqual(sends.map(r=>r.status).sort(),[200,409]);
  assert.equal((await (await call(path)).json()).versions.length,2);
});
test("room survives a restart and an expired turn can be reclaimed",async t=>{
  const {room,path,dir,bucket,call}=await setup(t);
  assert.deepEqual(await diskBucket(dir).get(room.id+"/room").json(),room);
  await call(path+"/claim","POST",alice);
  const key=room.id+"/room", saved=await bucket.get(key).json();
  saved.lease.until=Date.now()-1000;bucket.put(key,JSON.stringify(saved));
  assert.equal((await call(path+"/claim","POST",bob)).status,200);
  assert.equal((await call(path+"/release","POST",alice)).status,409);
});
test("unsupported, oversized and partial uploads are rejected",async t=>{
  const {call}=await setup(t);
  assert.equal((await call("","POST",alice,Buffer.from("text"))).status,415);
  assert.equal((await call("","POST",alice,photo,{"x-file-size":String(25*1024*1024)})).status,413);
  assert.equal((await call("","POST",alice,photo,{"x-file-size":String(photo.length+5)})).status,400);
  assert.equal((await call("/"+"0".repeat(32))).status,404);
});
