import type { Profile } from "../types/Profile";
import type { AuthedFetch } from "./apiClient";

async function parseApiError(response: Response): Promise<Error> {
  try {
    const body = (await response.json()) as { detail?: unknown };
    if (typeof body?.detail === "string" && body.detail.length > 0) {
      return new Error(body.detail);
    }
  } catch {
    // ignore json errors
  }
  return new Error(`Request failed (${response.status})`);
}

export async function createProfileIfMissing(
  authedFetch: AuthedFetch,
  params: {
    email: string;
    firstName?: string | null;
    lastName?: string | null;
  },
): Promise<Profile> {
  const response = await authedFetch("/v1/profile", {
    method: "POST",
    body: JSON.stringify({
      email: params.email,
      first_name: params.firstName ?? null,
      last_name: params.lastName ?? null,
    }),
  });

  if (!response.ok) throw await parseApiError(response);
  return (await response.json()) as Profile;
}

export async function updateProfile(
  authedFetch: AuthedFetch,
  params: {
    firstName: string | null;
    lastName: string | null;
    phoneNumber: string | null;
  },
): Promise<Profile> {
  const response = await authedFetch("/v1/profile", {
    method: "PATCH",
    body: JSON.stringify({
      first_name: params.firstName,
      last_name: params.lastName,
      phone_number: params.phoneNumber,
    }),
  });

  if (!response.ok) throw await parseApiError(response);
  return (await response.json()) as Profile;
}

export async function fetchProfile(
  authedFetch: AuthedFetch,
): Promise<Profile | null> {
  const response = await authedFetch("/v1/profile");
  if (response.status === 404) return null;
  if (!response.ok) throw await parseApiError(response);
  return (await response.json()) as Profile;
}

