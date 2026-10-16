// Dedicated loopback listener survives navigation and Next.js development reloads.
// Only the authorize URL is written to stdout; no credentials or callback query is logged.
import { createServer } from "node:http";
import {
  privateDirectory,
  withLock,
  readRecord,
  writeRecord,
  assertOwner,
  newRecord,
  createAttempt,
  callbackCode,
  validState,
  exchangeCode,
  loadModels,
  ATTEMPT_MS,
  CALLBACK_PATH,
  ConnectionError,
} from "./lib/chatgpt-connection.mjs";

const ownerId = process.env.TRAINI_OAUTH_OWNER;
if (!ownerId || !/^[\da-f-]{36}$/i.test(ownerId)) process.exit(1);
const directory = privateDirectory();
function reply(response, status, message) {
  response.writeHead(status, {
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "no-store",
    "Referrer-Policy": "no-referrer",
    "Content-Security-Policy":
      "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'",
    "X-Content-Type-Options": "nosniff",
  });
  response.end(
    `<!doctype html><html lang="ko"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Traini · ChatGPT</title><body style="font-family:system-ui;max-width:400px;margin:80px auto;padding:24px;line-height:1.7"><h1 style="font-size:20px">Traini · ChatGPT</h1><p>${message}</p><p>이 창을 닫고 Traini 화면으로 돌아가 주세요.</p></body></html>`,
  );
}
try {
  await withLock(directory, async () => {
    let record = (await readRecord(directory)) ?? newRecord(ownerId);
    assertOwner(record, ownerId);
    let attempt;
    let handling = false;
    let finish;
    const done = new Promise((resolve) => {
      finish = resolve;
    });
    const server = createServer(async (request, response) => {
      const port = server.address().port;
      if (
        request.method !== "GET" ||
        request.headers.host !== `127.0.0.1:${port}` ||
        !request.url ||
        request.url.length > 16384
      ) {
        reply(response, 400, "올바르지 않은 요청이에요.");
        return;
      }
      const url = new URL(request.url, `http://127.0.0.1:${port}`);
      if (url.pathname !== CALLBACK_PATH) {
        reply(response, 404, "요청한 페이지가 없어요.");
        return;
      }
      if (
        !attempt ||
        !validState(url.searchParams.get("state"), attempt.state)
      ) {
        reply(
          response,
          400,
          "연결 요청을 확인하지 못했어요. Traini에서 다시 시도해 주세요.",
        );
        return;
      }
      if (handling) {
        reply(response, 409, "이미 연결을 처리하고 있어요.");
        return;
      }
      handling = true;
      try {
        const result = callbackCode(url.searchParams, attempt);
        const validated = await exchangeCode(
          attempt,
          result,
          record.registration,
        );
        // A validated account survives temporary catalog errors without discarding rotating tokens.
        record = {
          ...record,
          ...validated,
          attempt: null,
          models: [],
          checkedAt: null,
        };
        await writeRecord(directory, record);
        record.models = await loadModels(record.credentials.accessToken);
        record.checkedAt = new Date().toISOString();
        await writeRecord(directory, record);
        reply(
          response,
          200,
          "ChatGPT 연결과 사용 가능한 모델 확인이 완료됐어요.",
        );
      } catch (error) {
        record.attempt = {
          state: "failed",
          error: error instanceof ConnectionError ? error.code : "connection",
        };
        await writeRecord(directory, record).catch(() => {});
        reply(
          response,
          400,
          "연결 확인을 완료하지 못했어요. Traini 화면에서 상태를 확인해 주세요.",
        );
      } finally {
        finish();
      }
    });
    server.requestTimeout = 20_000;
    server.headersTimeout = 10_000;
    server.maxConnections = 8;
    await new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });
    try {
      attempt = createAttempt(record, server.address().port);
      record.attempt = {
        state: "pending",
        expiresAt: Date.now() + ATTEMPT_MS,
        authorizeUrl: attempt.authorizeUrl,
        pid: process.pid,
      };
      await writeRecord(directory, record);
      process.stdout.write(
        JSON.stringify({ authorizeUrl: attempt.authorizeUrl }) + "\n",
      );
      let timer;
      await Promise.race([
        done,
        new Promise((resolve) => {
          timer = setTimeout(() => {
            if (!handling) resolve();
          }, ATTEMPT_MS);
        }),
      ]);
      clearTimeout(timer);
      if (record.attempt?.state === "pending") {
        record.attempt = { state: "failed", error: "timeout" };
        await writeRecord(directory, record);
      }
    } finally {
      server.close();
      // Allow an already-ended HTML response to flush before closing idle sockets.
      server.closeIdleConnections();
    }
  });
} catch (error) {
  process.stdout.write(
    JSON.stringify({
      error: error instanceof ConnectionError ? error.code : "connection",
    }) + "\n",
  );
  process.exitCode = 1;
}
