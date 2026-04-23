import { API_RESOURCE, logtoClient } from './logto';

export async function apiFetch(path: string, options?: RequestInit) {
  const token = await logtoClient.getAccessToken(API_RESOURCE);
  return fetch(`/api${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      ...options?.headers,
    },
  });
}
