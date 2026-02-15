import { api } from "./api";
import type { User } from "./types";

export async function me(): Promise<User | null> {
  const r = await api<{ user: User | null }>("/api/auth/me");
  return r.user;
}

export async function login(username: string, password: string, remember: boolean) {
  await api("/api/auth/login", { method: "POST", json: { username, password, remember } });
}

export async function register(
  username: string,
  password: string,
  captchaToken: string,
  inviteCode: string
) {
  await api("/api/auth/register", {
    method: "POST",
    json: { username, password, captchaToken, inviteCode }
  });
}

export async function logout() {
  await api("/api/auth/logout", { method: "POST" });
}
