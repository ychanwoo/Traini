# Local ChatGPT subscription connection

This is an explicit, separate connection from Traini's Google/Supabase administrator login.
It implements OpenAI's documented public-client OAuth flow for locally hosted applications.
It does not reuse the Codex app's credentials, ask for a ChatGPT password, or require an API key.

## Connect on the Mac running Traini

1. Start Traini with `npm run dev` (or the existing port 3017 command).
2. Sign in with the existing administrator Google account.
3. Open `/my/goals`, then choose **ChatGPT 연결 준비**.
4. Choose **Continue with ChatGPT**. Complete login and review the requested permissions on OpenAI's page yourself within 10 minutes.
5. Return to Traini. The card polls the local connection status. Successful identity validation is followed by a request for the account's visible model catalog.
6. If an embedded browser repeatedly reports `invalid_state` before the callback, use **승인 링크 복사** and paste the link into Safari or Chrome on the same Mac. This is a diagnostic retry in a regular browser, not proof of the cause. Do not reuse an expired attempt. After reloading Traini, **연결 이어하기** restores an unexpired flow only while its local listener is alive.
7. **연결 확인** refreshes expiring credentials if needed and rechecks the catalog. **연결 해제** revokes the renewable session before deleting local tokens.

If model lookup fails after successful OAuth, credentials are retained and the card asks for another connection check. An existing account's credentials survive cancellation, malformed callbacks, incorrect identity, and failed token exchange. Reauthorization must use the same ChatGPT identity and issued client ID. This personal MVP supports one administrator and one ChatGPT registration; switching to another ChatGPT account is not exposed.

The account's actual subscription eligibility, model access, and usage limits are provider-controlled and can only be confirmed after the user authorizes the connection. Hosted deployment is not enabled by this implementation. Do not assume this local-app registration can be moved to Vercel without the provider's hosted-app approval.

Connecting alone does **not** generate a training plan or send running history to OpenAI. A separate explicit generate action in Today/Schedule uses the weekly plan pipeline described in [weekly training plans](weekly-training-plan.md). Cookie server sessions and Proxy are implemented separately; see [admin authentication](admin-session-proxy.md).

## Storage and boundaries

The dedicated Node helper binds an ephemeral port on `127.0.0.1` before returning an authorization URL. The stable callback path is `/auth/callback`; only its port changes. The helper survives navigation and Next development reloads, and closes after completion or timeout. It receives only the administrator UUID and minimal runtime environment, not Supabase or Garmin secrets.

Credentials and host identity are stored outside the repository:

```text
~/Library/Application Support/Traini/auth/chatgpt/connection.json
```

The directory uses mode `0700`, the atomic replacement file uses `0600`, and credential reads reject symlinks and unsafe permissions. A process lock serializes connection, refresh and revocation. A dead worker's lock is recovered on the next operation. Tokens and the PKCE verifier never appear in application API responses or logs. The temporary state and nonce are included only in the official authorization URL, returned after an explicit administrator connect action; status polling does not return that URL. The authorization URL contains only temporary OAuth parameters, never access/refresh/ID tokens. Do not include this private directory in backups shared with others or troubleshooting reports.

The connection API verifies the existing server-side administrator allowlist before reading credentials. Mutations also check the request Origin and host. The API is restricted to HTTP localhost/127.0.0.1 on a local Mac and is disabled on Vercel. The first connection must run on the same Mac as the server, since the callback is loopback. This restriction is additional to the server-session/Proxy protection used by the rest of the app.

Signature, issuer, issued-client audience, expiration, nonce, verified subject and granted plan scopes are checked before activating a connection. The host ID and issued client registration survive sign-out. Refresh rotation is persisted before a subsequent model request. Revocation failure preserves credentials so the operation can be retried; the UI does not claim sign-out succeeded.

## Verify

```sh
npm run test:chatgpt
npm run test:admin
npm run test:garmin
npm run test:summary
npm run test:training
npm run lint
npm run build
```

Tests cover PKCE/state/nonce, signed JWT rejection cases, returning-account identity, permission checks, private storage, locking, rotated-token preservation, revocation, API authorization/origin restrictions and a real loopback worker's forged-state/denial handling. They never log into a real ChatGPT account. Live OAuth consent and model access require the user's own sign-in.

## Official references

- [Registration and sign-in](https://developers.openai.com/siwc/token-sharing-open-source/sign-in)
- [Accounts and sessions](https://developers.openai.com/siwc/token-sharing-open-source/profiles-and-sessions)
- [Models and inference](https://developers.openai.com/siwc/token-sharing-open-source/models-and-inference)
- [Preview limitations](https://developers.openai.com/siwc/token-sharing-open-source/preview-limitations)
