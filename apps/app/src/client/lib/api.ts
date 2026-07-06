import { API_RESOURCE, logtoClient } from './logto';

export async function apiFetch(path: string, options?: RequestInit) {
  let token: string;
  try {
    token = await logtoClient.getAccessToken(API_RESOURCE);
  } catch (error) {
    const detail = error instanceof Error ? `${error.name}: ${error.message}` : String(error ?? 'unknown auth error');
    throw new Error(`Authentication token unavailable: ${detail}`, { cause: error });
  }
  return fetch(`/api${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      ...options?.headers,
    },
  });
}
