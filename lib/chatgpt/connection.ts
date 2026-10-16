import "server-only";
import { spawn } from "node:child_process";
import { join } from "node:path";
import {
  privateDirectory,
  readRecord,
  publicStatus,
  checkConnection,
  disconnect,
  pendingAuthorization,
} from "@/scripts/lib/chatgpt-connection.mjs";

export type ChatGPTStatus = {
  connected: boolean;
  pending: boolean;
  email: string | null;
  models: { id: string; name: string }[];
  checkedAt: string | null;
  error: string | null;
  available: boolean;
};
export function localConnectionAvailable() {
  return process.platform === "darwin" && !process.env.VERCEL;
}
export async function connectionStatus(
  ownerId: string,
): Promise<ChatGPTStatus> {
  return {
    ...publicStatus(await readRecord(privateDirectory()), ownerId),
    available: localConnectionAvailable(),
  };
}
export async function verifyConnection(
  ownerId: string,
): Promise<ChatGPTStatus> {
  return {
    ...(await checkConnection(privateDirectory(), ownerId)),
    available: localConnectionAvailable(),
  };
}
export async function removeConnection(
  ownerId: string,
): Promise<ChatGPTStatus> {
  return {
    ...(await disconnect(privateDirectory(), ownerId)),
    available: localConnectionAvailable(),
  };
}
export async function startConnection(ownerId: string): Promise<string> {
  const pendingUrl = pendingAuthorization(
    await readRecord(privateDirectory()),
    ownerId,
  );
  if (pendingUrl) return pendingUrl;
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [join(process.cwd(), "scripts", "connect-chatgpt.mjs")],
      {
        detached: true,
        stdio: ["ignore", "pipe", "ignore"],
        // Never copy server credentials into the OAuth listener process.
        env: {
          NODE_ENV: process.env.NODE_ENV,
          HOME: process.env.HOME,
          PATH: process.env.PATH,
          TRAINI_OAUTH_OWNER: ownerId,
        },
      },
    );
    let output = "";
    let settled = false;
    const finish = (error?: Error, url?: string) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.stdout.destroy();
      child.unref();
      if (error) reject(error);
      else resolve(url!);
    };
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      finish(new Error("connection"));
    }, 10_000);
    child.on("error", () => finish(new Error("connection")));
    child.on("exit", () => finish(new Error("connection")));
    child.stdout.on("data", (chunk: Buffer) => {
      output += chunk.toString("utf8");
      if (output.length > 16_384) {
        child.kill("SIGTERM");
        finish(new Error("connection"));
        return;
      }
      if (!output.includes("\n")) return;
      try {
        const result = JSON.parse(output.split("\n")[0]);
        if (result.error) {
          finish(new Error(result.error));
          return;
        }
        const url = new URL(result.authorizeUrl);
        if (
          url.origin !== "https://auth.openai.com" ||
          url.pathname !== "/api/accounts/authorize"
        )
          throw new Error("connection");
        finish(undefined, url.toString());
      } catch {
        child.kill("SIGTERM");
        finish(new Error("connection"));
      }
    });
  });
}
