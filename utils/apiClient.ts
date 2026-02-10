import { useAuth } from "@clerk/clerk-expo";
import { useMemo } from "react";
import { Platform } from "react-native";

export type AuthedFetch = (
  path: string,
  init?: RequestInit,
) => Promise<Response>;

const rawBaseUrl = process.env.EXPO_PUBLIC_API_URL;

function normalizeBaseUrl(baseUrl: string): string {
  const trimmed = baseUrl.trim().replace(/\/+$/, "");

  if (Platform.OS !== "android") return trimmed;

  if (trimmed.startsWith("http://localhost")) {
    return trimmed.replace("http://localhost", "http://10.0.2.2");
  }
  if (trimmed.startsWith("http://127.0.0.1")) {
    return trimmed.replace("http://127.0.0.1", "http://10.0.2.2");
  }
  if (trimmed.startsWith("https://localhost")) {
    return trimmed.replace("https://localhost", "https://10.0.2.2");
  }
  if (trimmed.startsWith("https://127.0.0.1")) {
    return trimmed.replace("https://127.0.0.1", "https://10.0.2.2");
  }

  return trimmed;
}

export function useAuthedFetch(): AuthedFetch | null {
  const { getToken } = useAuth();

  return useMemo<AuthedFetch | null>(() => {
    if (!rawBaseUrl) return null;

    const baseUrl = normalizeBaseUrl(rawBaseUrl);

    return async (path: string, init?: RequestInit) => {
      const token = await getToken();
      const headers = new Headers(init?.headers ?? {});

      if (token) {
        headers.set("Authorization", `Bearer ${token}`);
      }

      if (init?.body && !headers.has("Content-Type")) {
        headers.set("Content-Type", "application/json");
      }

      const normalizedPath = path.startsWith("/") ? path : `/${path}`;
      const url = path.startsWith("http") ? path : `${baseUrl}${normalizedPath}`;

      return fetch(url, { ...init, headers });
    };
  }, [getToken]);
}

