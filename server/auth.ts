import {
  randomBytes,
  randomUUID,
  createHash,
  timingSafeEqual,
} from "node:crypto";
import path from "node:path";
import { createRemoteJWKSet, jwtVerify } from "jose";
import { ProtectedFile, atomicWrite, dataDirectory } from "./storage.js";
import { readFile } from "node:fs/promises";
const ISSUER = "https://auth.openai.com";
const RESOURCE = "https://api.openai.com/v1";
const SCOPE =
  "openid profile email offline_access resource.invoke chatgpt.tokens.use.direct";
const JWKS = createRemoteJWKSet(new URL(ISSUER + "/.well-known/jwks.json"));
export type Profile = {
  id: string;
  label: string;
  clientId: string;
  subject: string | null;
  accessToken?: string;
  refreshToken?: string;
  idToken?: string;
  scopes: string[];
  expiresAt?: number;
  earliestRefreshAt?: number;
  welcomed: boolean;
};
type Credentials = { version: 1; activeId: string | null; profiles: Profile[] };
type Pending = {
  state: string;
  nonce: string;
  verifier: string;
  redirectUri: string;
  profileId: string;
  clientId: string;
  browserSession: string;
  expires: number;
  newRegistration: boolean;
};
export class ServiceError extends Error {
  constructor(
    message: string,
    public code: string,
    public status = 400,
    public requestId?: string,
  ) {
    super(message);
  }
}
export const secureRandom = () => randomBytes(32).toString("base64url");
export function sameSecret(a: string, b: string) {
  const x = Buffer.from(a),
    y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}
export async function checkedJson(response: Response) {
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const code = body.error?.code || body.error || "http_" + response.status;
    const detail =
      typeof body.detail === "string"
        ? body.detail.slice(0, 300)
        : typeof body.error?.message === "string"
          ? body.error.message.slice(0, 300)
          : "요청을 완료하지 못했습니다.";
    throw new ServiceError(
      detail,
      String(code),
      response.status,
      response.headers.get("x-request-id") || undefined,
    );
  }
  return body;
}
export class ChatGPTAuth {
  private file = new ProtectedFile<Credentials>(
    path.join(dataDirectory, "auth", "accounts.credential"),
  );
  private credentials: Credentials = {
    version: 1,
    activeId: null,
    profiles: [],
  };
  private hostId = "";
  private pending = new Map<string, Pending>();
  private refreshing: Promise<string> | null = null;
  private failedRegistration: Profile | null = null;
  async init() {
    this.credentials = (await this.file.load()) || this.credentials;
    const hostFile = path.join(dataDirectory, "auth", "host.json");
    try {
      this.hostId = JSON.parse(
        await readFile(hostFile, "utf8"),
      ).ext_agent_host_id;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
      this.hostId = "urn:uuid:" + randomUUID();
      await atomicWrite(
        hostFile,
        JSON.stringify({ ext_agent_host_id: this.hostId }),
      );
    }
  }
  publicState() {
    return {
      activeId: this.credentials.activeId,
      profiles: this.credentials.profiles.map((p) => ({
        id: p.id,
        label: p.label,
        connected: Boolean(p.accessToken),
        sharing: p.scopes.includes("chatgpt.tokens.use.direct"),
        needsWelcome: Boolean(
          p.accessToken &&
          p.scopes.includes("chatgpt.tokens.use.direct") &&
          !p.welcomed,
        ),
      })),
      connected: Boolean(this.active()?.accessToken),
      sharing: Boolean(
        this.active()?.accessToken &&
        this.active()?.scopes.includes("chatgpt.tokens.use.direct"),
      ),
    };
  }
  private active() {
    return this.credentials.profiles.find(
      (p) => p.id === this.credentials.activeId,
    );
  }
  async begin(
    browserSession: string,
    redirectUri: string,
    accountId?: string,
    consent = false,
  ) {
    if (!/^http:\/\/127\.0\.0\.1:\d+\/auth\/callback$/.test(redirectUri))
      throw new Error("올바른 loopback 콜백이 필요합니다.");
    const profile = accountId
      ? this.credentials.profiles.find((p) => p.id === accountId)
      : this.failedRegistration;
    if (accountId && !profile)
      throw new ServiceError(
        "저장된 계정을 찾을 수 없습니다.",
        "account_not_found",
      );
    const p: Pending = {
      state: secureRandom(),
      nonce: secureRandom(),
      verifier: randomBytes(64).toString("base64url"),
      redirectUri,
      profileId: profile?.id || randomUUID(),
      clientId: profile?.clientId || "dynamic_agent_client",
      browserSession,
      expires: Date.now() + 10 * 60000,
      newRegistration: !profile,
    };
    for (const [state, old] of this.pending)
      if (old.expires < Date.now() || old.browserSession === browserSession)
        this.pending.delete(state);
    this.pending.set(p.state, p);
    const url = new URL(ISSUER + "/api/accounts/authorize");
    const params: Record<string, string> = {
      client_id: p.clientId,
      ext_agent_host_id: this.hostId,
      response_type: "code",
      redirect_uri: p.redirectUri,
      scope: SCOPE,
      resource: RESOURCE,
      state: p.state,
      nonce: p.nonce,
      code_challenge_method: "S256",
      code_challenge: createHash("sha256")
        .update(p.verifier)
        .digest("base64url"),
    };
    if (p.newRegistration) params.agent_name_hint = "TELL Rivals";
    else if (profile?.idToken) params.id_token_hint = profile.idToken;
    if (consent) params.prompt = "consent";
    Object.entries(params).forEach(([key, value]) =>
      url.searchParams.set(key, value),
    );
    return url.toString();
  }
  async callback(params: URLSearchParams, browserSession: string) {
    const state = params.get("state") || "";
    const p = this.pending.get(state);
    if (
      !p ||
      !sameSecret(p.state, state) ||
      !sameSecret(p.browserSession, browserSession) ||
      p.expires < Date.now()
    )
      throw new ServiceError(
        "로그인 요청이 만료되었거나 일치하지 않습니다. 다시 시작해 주세요.",
        "invalid_state",
      );
    this.pending.delete(state);
    if (params.has("error"))
      throw new ServiceError(
        "로그인 또는 플랜 사용 동의가 취소되었습니다.",
        "access_denied",
      );
    const returnedId = params.get("client_id");
    if (p.newRegistration) {
      if (!returnedId || returnedId === "dynamic_agent_client")
        throw new ServiceError(
          "등록된 client ID가 없습니다.",
          "registration_incomplete",
        );
      p.clientId = returnedId;
    } else if (returnedId && returnedId !== p.clientId)
      throw new ServiceError(
        "선택한 계정의 등록과 다릅니다.",
        "client_mismatch",
      );
    const code = params.get("code");
    if (!code) throw new ServiceError("인증 코드가 없습니다.", "missing_code");
    const existing = this.credentials.profiles.find(
      (item) => item.id === p.profileId,
    );
    const draft: Profile = existing || {
      id: p.profileId,
      label: "연결 " + (this.credentials.profiles.length + 1),
      clientId: p.clientId,
      subject: null,
      scopes: [],
      welcomed: false,
    };
    // Retain the issued ID if code exchange fails, so a fresh OAuth attempt can reuse the registration.
    this.failedRegistration = draft;
    if (!existing) {
      this.credentials.profiles.push(draft);
      await this.file.save(this.credentials);
    }
    const token = await checkedJson(
      await fetch(ISSUER + "/api/accounts/oauth/token", {
        method: "POST",
        body: new URLSearchParams({
          grant_type: "authorization_code",
          client_id: p.clientId,
          code,
          code_verifier: p.verifier,
          redirect_uri: p.redirectUri,
          resource: RESOURCE,
        }),
        signal: AbortSignal.timeout(15000),
      }),
    );
    const { payload } = await jwtVerify(token.id_token, JWKS, {
      issuer: ISSUER,
      audience: p.clientId,
      algorithms: ["RS256"],
      requiredClaims: ["exp", "sub", "nonce"],
    });
    if (payload.nonce !== p.nonce || typeof payload.sub !== "string")
      throw new ServiceError(
        "ID 토큰 검증에 실패했습니다.",
        "invalid_identity",
      );
    if (existing?.subject && existing.subject !== payload.sub)
      throw new ServiceError(
        "원래 연결한 계정과 다릅니다.",
        "identity_mismatch",
      );
    if (
      !token.access_token ||
      !token.scope ||
      !Number.isFinite(token.expires_in)
    )
      throw new ServiceError(
        "인증 응답이 불완전합니다.",
        "invalid_token_response",
      );
    const profile: Profile = {
      ...draft,
      subject: payload.sub,
      accessToken: token.access_token,
      refreshToken: token.refresh_token,
      idToken: token.id_token,
      scopes: String(token.scope).split(" "),
      expiresAt: Date.now() + token.expires_in * 1000,
      earliestRefreshAt: parseTime(token.earliest_refresh_at),
    };
    this.credentials.profiles = this.credentials.profiles.filter(
      (item) => item.id !== profile.id,
    );
    this.credentials.profiles.push(profile);
    this.credentials.activeId = profile.id;
    await this.file.save(this.credentials);
    this.failedRegistration = null;
  }
  async welcome() {
    const p = this.active();
    if (p) {
      p.welcomed = true;
      await this.file.save(this.credentials);
    }
  }
  async token(): Promise<string> {
    const p = this.active();
    if (!p?.accessToken)
      throw new ServiceError(
        "Continue with ChatGPT로 먼저 연결해 주세요.",
        "login_required",
        401,
      );
    if (!p.scopes.includes("chatgpt.tokens.use.direct"))
      throw new ServiceError(
        "ChatGPT 플랜 사용 동의가 필요합니다.",
        "plan_permission_required",
        403,
      );
    if (!p.expiresAt || p.expiresAt > Date.now() + 60000) return p.accessToken;
    if (
      p.earliestRefreshAt &&
      p.earliestRefreshAt > Date.now() &&
      p.expiresAt > Date.now()
    )
      return p.accessToken;
    if (!p.refreshToken)
      throw new ServiceError("다시 로그인해 주세요.", "login_required", 401);
    if (this.refreshing) return this.refreshing;
    this.refreshing = (async () => {
      try {
        const next = await checkedJson(
          await fetch(ISSUER + "/api/accounts/oauth/token", {
            method: "POST",
            body: new URLSearchParams({
              grant_type: "refresh_token",
              client_id: p.clientId,
              refresh_token: p.refreshToken!,
              resource: RESOURCE,
            }),
            signal: AbortSignal.timeout(15000),
          }),
        );
        if (
          !next.access_token ||
          !next.refresh_token ||
          !Number.isFinite(next.expires_in)
        )
          throw new ServiceError(
            "토큰 갱신 응답이 불완전합니다.",
            "invalid_refresh_response",
          );
        p.accessToken = next.access_token;
        p.refreshToken = next.refresh_token;
        p.expiresAt = Date.now() + next.expires_in * 1000;
        p.earliestRefreshAt = parseTime(next.earliest_refresh_at);
        if (next.scope) p.scopes = next.scope.split(" ");
        await this.file.save(this.credentials);
        if (!p.scopes.includes("chatgpt.tokens.use.direct"))
          throw new ServiceError(
            "플랜 사용 권한을 다시 설정해 주세요.",
            "plan_permission_required",
            403,
          );
        return p.accessToken!;
      } catch (e) {
        if (
          e instanceof ServiceError &&
          [
            "invalid_grant",
            "invalid_refresh_token",
            "token_expired",
            "refresh_token_expired",
            "refresh_token_invalidated",
            "refresh_token_reused",
          ].includes(e.code)
        ) {
          delete p.accessToken;
          delete p.refreshToken;
          delete p.idToken;
          p.scopes = [];
          await this.file.save(this.credentials);
        }
        throw e;
      } finally {
        this.refreshing = null;
      }
    })();
    return this.refreshing;
  }
  async logout() {
    const p = this.active();
    let revoked = true;
    if (p?.refreshToken) {
      revoked = false;
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          const discovery = await checkedJson(
            await fetch(ISSUER + "/.well-known/openid-configuration", {
              signal: AbortSignal.timeout(5000),
            }),
          );
          const endpoint = new URL(discovery.revocation_endpoint);
          if (endpoint.origin !== ISSUER)
            throw new Error("Invalid revocation endpoint");
          const r = await fetch(endpoint, {
            method: "POST",
            body: new URLSearchParams({
              token: p.refreshToken,
              token_type_hint: "refresh_token",
              client_id: p.clientId,
            }),
            signal: AbortSignal.timeout(5000),
          });
          if (r.ok) {
            revoked = true;
            break;
          }
          if (r.status < 500) break;
        } catch {
          /* bounded retry */
        }
        if (attempt === 0) await new Promise((r) => setTimeout(r, 500));
      }
    }
    if (p) {
      delete p.accessToken;
      delete p.refreshToken;
      delete p.idToken;
      delete p.expiresAt;
      p.scopes = [];
    }
    this.credentials.activeId = null;
    await this.file.save(this.credentials);
    return revoked;
  }
  async models(): Promise<{ slug: string; display_name: string }[]> {
    const token = await this.token();
    const body = await checkedJson(
      await fetch(RESOURCE + "/models", {
        headers: { Authorization: "Bearer " + token },
        signal: AbortSignal.timeout(15000),
      }),
    );
    if (!Array.isArray(body.models))
      throw new ServiceError(
        "계정의 모델 목록을 읽을 수 없습니다.",
        "invalid_catalog",
      );
    return body.models
      .filter((m: { visibility: string }) => m.visibility === "list")
      .map((m: { slug: string; display_name: string }) => ({
        slug: m.slug,
        display_name: m.display_name,
      }));
  }
}
function parseTime(value: unknown) {
  if (typeof value === "number") return value > 1e12 ? value : value * 1000;
  if (typeof value === "string") return Date.parse(value) || undefined;
  return undefined;
}
