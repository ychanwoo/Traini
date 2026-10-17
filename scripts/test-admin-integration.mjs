import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";

// Opt-in, real HTTP/DB regression. Never emails a login link, changes the real
// account password, generates a training plan, or imports Garmin activities.
const origin = process.env.TRAINI_TEST_ORIGIN ?? "http://localhost:3017";
assert.ok(["http://localhost:3017", "http://127.0.0.1:3017"].includes(origin), "Tests must target the local Traini server");
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
assert.equal(new URL(url).hostname,"kmmutfcgshellvjgpick.supabase.co");
const service = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession:false,autoRefreshToken:false } });
const anon = () => createClient(url,process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
const jar = () => new Map();
function ssr(cookies) {
  return createServerClient(url,process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,{
    cookies:{getAll:()=>[...cookies].map(([name,value])=>({name,value})),setAll(values){for(const {name,value,options} of values){if(options.maxAge===0)cookies.delete(name);else cookies.set(name,value);}}},
  });
}
async function request(path,cookies=jar(),options={}) {
  const headers=new Headers(options.headers);
  if(cookies.size) headers.set('cookie',[...cookies].map(([k,v])=>`${k}=${v}`).join('; '));
  if(options.method && options.method!=='GET' && !headers.has('origin'))headers.set('origin',origin);
  const response=await fetch(origin+path,{...options,headers,redirect:'manual',signal:AbortSignal.timeout(30_000)});
  for(const cookie of response.headers.getSetCookie()) {
    const [pair]=cookie.split(';');const i=pair.indexOf('=');const name=pair.slice(0,i),value=pair.slice(i+1);
    if(/max-age=0/i.test(cookie))cookies.delete(name);else cookies.set(name,value);
  }
  return response;
}
function expectStatus(response,status,label) { assert.equal(response.status,status,label); }
let outsiderId;
const adminCookies=jar();
try {
  // Missing and forged credentials cannot fetch a protected page or data.
  for(const path of ['/today','/schedule','/roadmap','/my','/my/goals','/goal-setting','/garmin-connect','/running-analysis','/today.png']) {
    const r=await request(path);expectStatus(r,307,path);assert.equal(new URL(r.headers.get('location'),origin).pathname,'/login');
  }
  expectStatus(await request('/login'),200,'login remains public');
  expectStatus(await request('/icons/google.svg'),200,'login icon remains public');
  for(const path of ['/api/admin/session','/api/training/review','/api/training/plan','/api/training/context','/api/training/goal','/api/garmin/sync','/api/garmin/weekly-summary','/api/chatgpt/connection','/api/weather?lat=34&lon=-118','/api/garmin/connect','/api/garmin/callback']) expectStatus(await request(path),401,path);
  for(const path of ['/api/training/generate','/api/training/complete','/api/training/review','/api/training/match','/api/training/match/reconcile','/api/garmin/sync','/api/garmin/webhook','/api/chatgpt/connection']) expectStatus(await request(path,jar(),{method:'POST'}),401,path);
  expectStatus(await request('/api/training/goal',jar(),{method:'PUT'}),401,'goal mutation');
  expectStatus(await request('/api/training/plan',new Map([['sb-kmmutfcgshellvjgpick-auth-token','base64-forged']])),401,'forged cookie');
  console.log('PASS: anonymous pages, APIs and forged cookies');

  // A throwaway account proves that authentication alone does not grant access.
  const email=`traini-auth-test-${randomUUID()}@example.invalid`;
  const password=randomUUID()+randomUUID();
  const created=await service.auth.admin.createUser({email,password,email_confirm:true});
  assert.ifError(created.error);outsiderId=created.data.user.id;
  const outsider=anon();const signed=await outsider.auth.signInWithPassword({email,password});assert.ifError(signed.error);
  const outsiderCookies=jar();assert.ifError((await ssr(outsiderCookies).auth.setSession(signed.data.session)).error);
  for(const path of ['/api/admin/session','/api/training/review','/api/training/plan','/api/garmin/sync','/api/weather?lat=34&lon=-118'])expectStatus(await request(path,outsiderCookies),403,path);
  expectStatus(await request('/api/training/generate',outsiderCookies,{method:'POST'}),403,'outsider cannot invoke AI');
  const denied=await request('/schedule',outsiderCookies);expectStatus(denied,307,'outsider page');assert.equal(new URL(denied.headers.get('location'),origin).searchParams.get('error'),'admin');
  const records=await outsider.from('profiles').select('id');assert.ifError(records.error);assert.deepEqual(records.data,[]);
  assert.ok((await outsider.from('profiles').insert({id:outsiderId,display_name:'must be denied'})).error,'RLS denies own profile insert');
  assert.ok((await outsider.from('traini_admin_config').select('*')).error,'admin configuration is private');
  console.log('PASS: non-admin pages, APIs, AI denial and direct Supabase RLS');

  // generateLink does not send email; verify it only in this isolated HTTP jar.
  const account=await service.auth.admin.getUserById(process.env.TRAINI_ADMIN_USER_ID);assert.ifError(account.error);
  const link=await service.auth.admin.generateLink({type:'magiclink',email:account.data.user.email});assert.ifError(link.error);
  const signedAdmin=await anon().auth.verifyOtp({type:'magiclink',token_hash:link.data.properties.hashed_token});assert.ifError(signedAdmin.error);
  assert.ifError((await ssr(adminCookies).auth.setSession(signedAdmin.data.session)).error);
  for(const path of ['/today','/schedule','/roadmap','/my','/my/goals','/garmin-connect'])expectStatus(await request(path,adminCookies),200,path);
  for(const path of ['/api/admin/session','/api/training/review','/api/training/plan','/api/training/context','/api/training/goal','/api/garmin/weekly-summary','/api/garmin/sync','/api/chatgpt/connection'])expectStatus(await request(path,adminCookies),200,path);
  const unsafe=await request('/login?next=//evil.test',adminCookies);expectStatus(unsafe,307,'authenticated login');assert.equal(new URL(unsafe.headers.get('location'),origin).pathname,'/today');
  for(const [path,method] of [['/api/training/generate','POST'],['/api/training/goal','PUT'],['/auth/signout','POST']]) expectStatus(await request(path,adminCookies,{method,headers:{origin:'https://evil.test'}}),403,'foreign origin');
  expectStatus(await request('/auth/callback'),307,'missing OAuth code');
  expectStatus(await request('/auth/callback?code=invalid-code'),307,'invalid OAuth code');
  console.log('PASS: admin pages, read APIs, callback errors and CSRF denial');

  // Corrupt only this fixture's access token, keeping its refresh token intact.
  const staleCookies=jar();
  const staleClient=ssr(staleCookies);
  assert.ifError((await staleClient.auth.setSession(signedAdmin.data.session)).error);
  const key='sb-kmmutfcgshellvjgpick-auth-token';
  const pieces=[...staleCookies].filter(([name])=>name===key||name.startsWith(key+'.')).sort(([a],[b])=>a.localeCompare(b));
  const stored=JSON.parse(Buffer.from(pieces.map(([,v])=>v).join('').slice(7),'base64url').toString());
  const token=stored.access_token.split('.');const payload=JSON.parse(Buffer.from(token[1],'base64url').toString());payload.exp=1;
  token[1]=Buffer.from(JSON.stringify(payload)).toString('base64url');stored.access_token=token.join('.');stored.expires_at=1;
  staleCookies.clear();staleCookies.set(key,'base64-'+Buffer.from(JSON.stringify(stored)).toString('base64url'));
  const refreshed=await request('/schedule',staleCookies);expectStatus(refreshed,200,'expired access token is refreshed');assert.ok(refreshed.headers.getSetCookie().length,'refresh writes cookies');
  expectStatus(await request('/api/admin/session',staleCookies),200,'refreshed cookie works in API');
  expectStatus(await request('/auth/signout',staleCookies,{method:'POST'}),200,'sign out');
  expectStatus(await request('/api/admin/session',staleCookies),401,'logged out API');
  expectStatus(await request('/schedule',staleCookies),307,'logged out page');
  console.log('PASS: access-token expiry, refresh cookie propagation and logout');
} finally {
  if(adminCookies.size) await request('/auth/signout',adminCookies,{method:'POST'}).catch(()=>{});
  if(outsiderId){const removed=await service.auth.admin.deleteUser(outsiderId);assert.ifError(removed.error);}
}
console.log('All live authentication checks passed; temporary account removed.');
