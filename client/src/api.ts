import { useSession } from "./store";
export class ApiError extends Error {
  constructor(
    public code: string,
    public status = 0,
  ) {
    super(code);
  }
}
export async function api<T>(
  url: string,
  options: RequestInit = {},
): Promise<T> {
  const token = useSession.getState().token;
  let res: Response;
  try {
    res = await fetch(`/api${url}`, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...options.headers,
      },
      signal: options.signal ?? AbortSignal.timeout(15000),
    });
  } catch {
    throw new ApiError("NETWORK");
  }
  const body = await res.json().catch(() => ({ error: "SERVER_ERROR" }));
  if (!res.ok) {
    if (res.status === 401 && url !== "/auth") {
      sessionStorage.removeItem("bingo-token");
      useSession.getState().set({ token: null, user: null });
    }
    throw new ApiError(body.error ?? "SERVER_ERROR", res.status);
  }
  return body.data as T;
}
export function post<T>(url: string, data: unknown = {}) {
  return api<T>(url, { method: "POST", body: JSON.stringify(data) });
}
