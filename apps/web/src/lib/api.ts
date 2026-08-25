export const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:8080/api/v1';

export async function apiFetch<T>(path: string, revalidateSeconds?: number): Promise<T> {
  const res = await fetch(`${API_BASE_URL}${path}`, {
    next: revalidateSeconds ? { revalidate: revalidateSeconds } : undefined,
  });
  if (!res.ok) {
    throw new Error(`API ${res.status}: ${path}`);
  }
  return (await res.json()) as T;
}
