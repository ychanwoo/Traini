import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import ts from 'typescript';
import { NextRequest, NextResponse } from 'next/server.js';

function load(file, modules, env = {}) {
  const context = { exports: {}, require(id) { if (!(id in modules)) throw new Error(`Unexpected module ${id}`); return modules[id]; }, process: { env }, Response, Request, URL, AbortSignal, fetch };
  vm.runInNewContext(ts.transpileModule(readFileSync(new URL(`../${file}`, import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText, context);
  return context.exports;
}
const redirect = load('lib/auth/redirect.ts',{});
const env = { NEXT_PUBLIC_SUPABASE_URL:'https://project.supabase.co', NEXT_PUBLIC_SUPABASE_ANON_KEY:'public-key', TRAINI_ADMIN_USER_ID:'owner' };
function proxyFixture({ user=null, error=null, throws=false, refresh=false, configured=true }={}) {
  let calls=0;
  const {proxy}=load('proxy.ts',{
    'next/server':{NextRequest,NextResponse}, '@/lib/auth/redirect':redirect,
    '@supabase/ssr':{createServerClient(_url,_key,options){return {auth:{async getUser(){calls++; if(throws) throw new Error('private provider error'); if(refresh) options.cookies.setAll([{name:'session',value:'rotated',options:{path:'/',httpOnly:true}}]); return {data:{user},error};}}};}},
  },configured?env:{});
  return {proxy,calls:()=>calls};
}

test('return destination rejects external URLs, encoded separators and auth loops',()=>{
  for(const value of ['https://evil.test','//evil.test','/\\evil.test','/login','/auth/callback','/api/training/generate','/my/%2f%2fevil','/today?next=//evil','/my/unknown',null]) assert.equal(redirect.safeDestination(value),'/today');
  for(const value of ['/schedule','/garmin-connect','/my/goals']) assert.equal(redirect.safeDestination(value),value);
});
test('protected page URLs redirect before rendering and preserve only known return paths',async()=>{
  const f=proxyFixture();
  for(const path of ['/today','/schedule','/roadmap','/garmin-connect','/my/goals','/today.png','/unknown']) {
    const r=await f.proxy(new NextRequest('https://traini.test'+path));
    assert.equal(r.status,307); const target=new URL(r.headers.get('location'));
    assert.equal(target.pathname,'/login'); assert.equal(target.searchParams.get('next'),redirect.safeDestination(path));
    assert.match(r.headers.get('cache-control'),/no-store/);
  }
});
test('forged cookie presence and caller supplied admin headers do not authorize',async()=>{
  const f=proxyFixture();const r=await f.proxy(new NextRequest('https://traini.test/today',{headers:{cookie:'session=forged','x-user-id':'owner','x-middleware-subrequest':'proxy'}}));assert.equal(r.status,307);assert.equal(f.calls(),1);
});
test('verified admin proceeds and refreshed cookies reach request and response',async()=>{
  const f=proxyFixture({user:{id:'owner'},refresh:true});const request=new NextRequest('https://traini.test/today');const r=await f.proxy(request);
  assert.equal(r.status,200); assert.equal(request.cookies.get('session').value,'rotated');assert.equal(r.cookies.get('session').value,'rotated');assert.match(r.headers.get('cache-control'),/no-store/);
});
test('refresh cookies survive denial redirects and public login responses',async()=>{
  for(const path of ['/today','/login']) {const f=proxyFixture({refresh:true});const r=await f.proxy(new NextRequest('https://traini.test'+path));assert.equal(r.cookies.get('session').value,'rotated');assert.match(r.headers.get('cache-control'),/no-store/);}
});
test('non-admin, auth outage and missing configuration fail closed without redirect loops',async()=>{
  for(const options of [{user:{id:'outsider'}},{throws:true},{error:{status:503}},{configured:false}]) {
    const f=proxyFixture(options);const r=await f.proxy(new NextRequest('https://traini.test/schedule'));assert.equal(r.status,307);assert.equal(new URL(r.headers.get('location')).searchParams.get('error'),options.user?'admin':'connection');
    const login=await f.proxy(new NextRequest('https://traini.test/login'));assert.equal(login.status,200);assert.doesNotMatch(await login.text(),/private provider/);
  }
});
test('admin login return uses a local allowlist and auth callback bypasses page redirect',async()=>{
  const f=proxyFixture({user:{id:'owner'}});for(const [next,expected] of [['//evil.test','/today'],['/schedule','/schedule']]){const r=await f.proxy(new NextRequest('https://traini.test/login?next='+encodeURIComponent(next)));assert.equal(r.headers.get('location'),'https://traini.test'+expected);}
  const fresh=proxyFixture();for(const path of ['/auth/callback?code=opaque','/auth/signout','/api/training/generate']){assert.equal((await fresh.proxy(new NextRequest('https://traini.test'+path))).status,200);}assert.equal(fresh.calls(),0);
});

function accessFixture({user={id:'owner'},error=null,throws=false,configured=true}={}){
  let reads=0;
  const client={auth:{async getUser(){reads++;if(throws)throw new Error('private');return {data:{user},error};}}};
  return {...load('lib/security/admin.ts',{'@/lib/supabase/admin':{getSupabaseAdmin:()=>client},'@/lib/supabase/server':{getSupabaseServerClient:async()=>client}},configured?env:{}),reads:()=>reads};
}
test('cookie API accepts only server verified administrator and reports expiry, denial and outage',async()=>{
  for(const [options,status] of [[{},200],[{user:{id:'other'}},403],[{user:null},401],[{error:{status:503}},503],[{throws:true},503],[{configured:false},503]]) {
    const f=accessFixture(options);const r=await f.requireAdmin(new Request('https://traini.test/api/training/plan'));assert.equal(r.response?.status??200,status);
  }
});
test('cookie mutations reject missing or foreign Origin before auth, while same-origin succeeds',async()=>{
  for(const origin of [null,'https://evil.test','null']){const f=accessFixture();const r=await f.requireAdmin(new Request('https://traini.test/api/training/complete',{method:'POST',headers:origin?{origin}:{}}));assert.equal(r.response.status,403);assert.equal(f.reads(),0);}
  const f=accessFixture();assert.equal((await f.requireAdmin(new Request('https://traini.test/api/training/complete',{method:'POST',headers:{origin:'https://traini.test'}}))).userId,'owner');
});
test('explicit invalid bearer never falls back to a valid cookie',async()=>{
  const f=accessFixture();const r=await f.requireAdmin(new Request('https://traini.test/api/training/plan',{headers:{authorization:'Basic forged'}}));assert.equal(r.response.status,401);assert.equal(f.reads(),0);
});

test('all API routes independently enforce admin authorization including retired Garmin and weather',()=>{
  function walk(path){return readdirSync(new URL('../'+path,import.meta.url),{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(path+'/'+e.name):e.name==='route.ts'?[path+'/'+e.name]:[]);}
  for(const file of walk('app/api')){const source=readFileSync(new URL('../'+file,import.meta.url),'utf8');assert.match(source,/requireAdmin\(request\)/,file);}
});

function callbackFixture({exchangeError=null,user={id:'owner'},userError=null,throws=false}={}) {
  let exchange=0,logout=0;
  const client={auth:{async exchangeCodeForSession(){exchange++;if(throws)throw new Error('secret');return {error:exchangeError};},async getUser(){return {data:{user},error:userError};},async signOut(){logout++;return {error:null};}}};
  return {...load('app/auth/callback/route.ts',{'next/server':{NextResponse},'@/lib/supabase/server':{getSupabaseServerClient:async()=>client},'@/lib/auth/redirect':redirect},env),exchange:()=>exchange,logout:()=>logout};
}
test('PKCE callback requires code, handles provider denial and never reflects provider error text',async()=>{
  for(const path of ['/auth/callback','/auth/callback?error=secret-provider-detail']){const f=callbackFixture();const r=await f.GET(new NextRequest('https://traini.test'+path));assert.equal(f.exchange(),0);assert.equal(r.headers.get('location'),'https://traini.test/login?error=oauth');assert.match(r.headers.get('cache-control'),/no-store/);}
});
test('PKCE callback verifies user independently, signs out non-admin and validates return destination',async()=>{
  const denied=callbackFixture({user:{id:'other'}});const r=await denied.GET(new NextRequest('https://traini.test/auth/callback?code=opaque'));assert.equal(r.headers.get('location'),'https://traini.test/login?error=admin');assert.equal(denied.logout(),1);
  for(const [next,path] of [['/schedule','/schedule'],['https://evil.test','/today']]){const f=callbackFixture();const r=await f.GET(new NextRequest('https://traini.test/auth/callback?code=opaque&next='+encodeURIComponent(next)));assert.equal(r.headers.get('location'),'https://traini.test'+path);}
});
test('PKCE callback handles replay, invalid exchange and temporary outage',async()=>{
  for(const [options,reason] of [[{exchangeError:new Error('private')},'oauth'],[{user:null},'oauth'],[{throws:true},'connection']]){const f=callbackFixture(options);const r=await f.GET(new NextRequest('https://traini.test/auth/callback?code=opaque'));assert.equal(new URL(r.headers.get('location')).searchParams.get('error'),reason);}
});
test('server page guard independently rejects non-admin, revoked and unavailable sessions',async()=>{
  for(const user of [null,{id:'other'},{id:'owner'}]){
    const f=load('lib/auth/page-access.ts',{'server-only':{},'next/navigation':{redirect(path){throw new Error(path);}},'@/lib/supabase/server':{getSupabaseServerClient:async()=>({auth:{getUser:async()=>({data:{user},error:null})}})}},env);
    if(user?.id==='owner')await f.requireAdminPage();else await assert.rejects(f.requireAdminPage(),/\/login\?error=(admin|expired)/);
  }
});
test('logout refuses foreign origins and preserves retryable errors without leaking details',async()=>{
  let calls=0;
  const route=(error=null)=>load('app/auth/signout/route.ts',{'@/lib/security/admin':{sameOrigin:r=>r.headers.get('origin')==='https://traini.test'},'@/lib/supabase/server':{getSupabaseServerClient:async()=>({auth:{signOut:async()=>{calls++;return {error};}}})}});
  assert.equal((await route().POST(new Request('https://traini.test/auth/signout',{method:'POST'}))).status,403);assert.equal(calls,0);
  const request=()=>new Request('https://traini.test/auth/signout',{method:'POST',headers:{origin:'https://traini.test'}});
  assert.equal((await route().POST(request())).status,200);
  const failure=await route(new Error('private credentials')).POST(request());assert.equal(failure.status,503);assert.doesNotMatch(await failure.text(),/private credentials/);
});
test('browser client removes only the legacy session and uses cookie-backed PKCE client',()=>{
  const removed=[];let options;let creations=0;
  const context={exports:{},process:{env},URL,window:{location:{protocol:'https:'},localStorage:{removeItem:key=>removed.push(key)}},require:id=>{assert.equal(id,'@supabase/ssr');return {createBrowserClient(_url,_key,value){creations++;options=value;return {cookieClient:true};}};}};
  const source=readFileSync(new URL('../lib/supabase/client.ts',import.meta.url),'utf8');vm.runInNewContext(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText,context);
  assert.ok(context.exports.getSupabaseBrowserClient().cookieClient);context.exports.getSupabaseBrowserClient();assert.equal(creations,1);assert.deepEqual(removed,['sb-project-auth-token']);assert.equal(options.cookieOptions.secure,true);assert.equal(options.cookieOptions.sameSite,'lax');
});
