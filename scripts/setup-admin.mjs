import { createClient } from "@supabase/supabase-js";
import { readFile, rename, writeFile, unlink } from "node:fs/promises";
import { createInterface } from "node:readline/promises";
import { randomUUID } from "node:crypto";

// Read-only in Supabase; only the local .env.local allowlist is changed.
const envPath = new URL("../.env.local", import.meta.url);
const temporary = new URL(`../.env.local.${randomUUID()}.tmp`, import.meta.url);
let prompt;
try {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error(".env.local에 Supabase 설정이 필요합니다.");
  if (new URL(url).hostname !== "kmmutfcgshellvjgpick.supabase.co") {
    throw new Error("설정된 Supabase 프로젝트가 Traini 프로젝트와 다릅니다.");
  }
  const supabase = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const users = [];
  for (let page = 1; ; page++) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 100 });
    if (error) throw new Error("Supabase 계정 목록 조회에 실패했습니다.");
    users.push(...data.users.filter((user) => (user.app_metadata.providers?.includes("google") || user.identities?.some((identity) => identity.provider === "google"))));
    if (data.users.length < 100) break;
    if (page >= 100) throw new Error("계정이 너무 많습니다. 관리자 UUID를 직접 설정해 주세요.");
  }
  if (!users.length) throw new Error("기존 Google 계정이 없습니다. Supabase Auth에서 계정을 확인해 주세요.");
  let selected;
  if (process.argv.includes("--auto-single")) {
    if (users.length !== 1) throw new Error("Google 계정이 여러 개입니다. npm run admin:setup으로 직접 선택해 주세요.");
    selected = users[0];
  } else {
    if (!process.stdin.isTTY) throw new Error("터미널에서 npm run admin:setup을 실행해 주세요.");
    users.forEach((user, index) => console.log(`${index + 1}. ${user.email ?? "이메일 없음"}`));
    prompt = createInterface({ input: process.stdin, output: process.stdout });
    const choice = await prompt.question("관리자로 사용할 기존 Google 계정 번호: ");
    if (!/^\d+$/.test(choice.trim())) throw new Error("유효한 계정 번호를 입력해 주세요.");
    selected = users[Number(choice) - 1];
    if (!selected) throw new Error("유효한 계정 번호를 입력해 주세요.");
  }
  const contents = await readFile(envPath, "utf8");
  const lines = contents.split(/\r?\n/).filter((line) => !/^\s*(export\s+)?TRAINI_ADMIN_USER_ID\s*=/.test(line));
  const updated = `${lines.join("\n").trimEnd()}\nTRAINI_ADMIN_USER_ID=${selected.id}\n`;
  await writeFile(temporary, updated, { mode: 0o600, flag: "wx" });
  await rename(temporary, envPath);
  console.log("기존 Google 계정을 관리자로 설정했습니다. 개발 서버를 다시 시작해 주세요.");
} catch (error) {
  console.error(error instanceof Error ? error.message : "관리자 설정에 실패했습니다.");
  process.exitCode = 1;
} finally {
  prompt?.close();
  await unlink(temporary).catch(() => {});
}
