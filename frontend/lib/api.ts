// ============================================================
// ClauseGuard AI — Typed API client
// All requests go through Next.js rewrites -> NEXT_PUBLIC_API_URL
// ============================================================

import type {
  HealthResponse,
  SampleContractResponse,
  StartThreadResponse,
  ThreadState,
  ResumeRequest,
  ResumeResponse,
} from "@/types/contract";

const API_BASE =
  typeof window !== "undefined"
    ? "" // client: use Next.js rewrites /api/*
    : process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000"; // SSR

async function apiFetch<T>(
  path: string,
  options?: RequestInit
): Promise<T> {
  const url = `${API_BASE}${path}`;
  const res = await fetch(url, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(options?.headers ?? {}),
    },
  });

  if (!res.ok) {
    let detail = `HTTP ${res.status}`;
    try {
      const json = await res.json();
      detail = json.detail ?? JSON.stringify(json);
    } catch {
      /* ignore */
    }
    throw new Error(detail);
  }

  return res.json() as Promise<T>;
}

// ---- Health ----
export async function getHealth(): Promise<HealthResponse> {
  return apiFetch<HealthResponse>("/api/health");
}

// ---- Sample Contract ----
export async function getSampleContract(): Promise<SampleContractResponse> {
  return apiFetch<SampleContractResponse>("/api/sample-contract");
}

// ---- Start Thread (file or raw text) ----
export async function startThread(formData: FormData): Promise<StartThreadResponse> {
  const url = `${API_BASE}/api/threads/start`;
  const res = await fetch(url, {
    method: "POST",
    body: formData,
    // No Content-Type header — browser sets multipart/form-data with boundary
  });
  if (!res.ok) {
    let detail = `HTTP ${res.status}`;
    try {
      const json = await res.json();
      detail = json.detail ?? JSON.stringify(json);
    } catch {
      /* ignore */
    }
    throw new Error(detail);
  }
  return res.json() as Promise<StartThreadResponse>;
}

// ---- Get Thread State (snapshot for refresh restore) ----
export async function getThreadState(threadId: string): Promise<ThreadState> {
  return apiFetch<ThreadState>(`/api/threads/${threadId}/state`);
}

// ---- Resume Thread (HITL decisions) ----
export async function resumeThread(
  threadId: string,
  payload: ResumeRequest
): Promise<ResumeResponse> {
  return apiFetch<ResumeResponse>(`/api/threads/${threadId}/resume`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

// ---- SSE stream URL helper ----
export function getStreamUrl(threadId: string): string {
  return `${API_BASE}/api/threads/${threadId}/stream`;
}

// ---- Export download URL ----
export function getExportUrl(threadId: string): string {
  return `${API_BASE}/api/threads/${threadId}/export`;
}

