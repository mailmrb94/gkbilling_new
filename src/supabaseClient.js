const supabaseUrl = import.meta.env.VITE_SUPABASE_URL?.replace(/\/$/, "") || "";
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || "";
const workspaceId = import.meta.env.VITE_SUPABASE_WORKSPACE || "default";

const restBaseUrl = supabaseUrl ? `${supabaseUrl}/rest/v1` : "";

export const isSupabaseConfigured = Boolean(supabaseUrl && supabaseAnonKey);
export const supabaseWorkspaceId = workspaceId;

function ensureConfigured() {
  if (!isSupabaseConfigured) {
    throw new Error("Supabase environment variables are not configured");
  }
}

function buildHeaders(extra = {}) {
  if (!isSupabaseConfigured) return extra;
  return {
    apikey: supabaseAnonKey,
    Authorization: `Bearer ${supabaseAnonKey}`,
    "Content-Type": "application/json",
    ...extra,
  };
}

async function request(path, { method = "GET", body, headers = {}, signal } = {}) {
  ensureConfigured();
  const finalHeaders = buildHeaders(headers);
  const options = { method, headers: finalHeaders, signal };
  if (body !== undefined) {
    options.body = typeof body === "string" ? body : JSON.stringify(body);
  } else if (method === "POST" || method === "PATCH" || method === "PUT") {
    options.body = body === undefined ? "{}" : options.body;
  }
  const response = await fetch(`${restBaseUrl}/${path}`, options);
  if (!response.ok) {
    let message = response.statusText;
    try {
      const errorData = await response.json();
      message = errorData?.message || message;
    } catch (error) {
      try {
        const text = await response.text();
        if (text) message = text;
      } catch {
        /* ignore */
      }
    }
    throw new Error(message || "Supabase request failed");
  }
  if (response.status === 204) return null;
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function encodeFilterValue(operator, value) {
  if (operator === "in") {
    if (!Array.isArray(value)) {
      throw new Error("Value for 'in' operator must be an array");
    }
    const list = value
      .map((item) => {
        if (typeof item === "number" || typeof item === "boolean") return String(item);
        if (item === null || item === undefined) return "null";
        return `\"${String(item).replace(/\"/g, '\\"')}\"`;
      })
      .join(",");
    return `${operator}.(${list})`;
  }
  return `${operator}.${value}`;
}

function buildQueryParams({ select, filters = [], order, limit } = {}) {
  const params = new URLSearchParams();
  if(select){
    params.set("select", select);
  }
  if (Array.isArray(filters)) {
    for (const filter of filters) {
      if (!filter?.column || !filter?.operator) continue;
      params.set(filter.column, encodeFilterValue(filter.operator, filter.value));
    }
  }
  if (order?.column) {
    const direction = order.ascending === false ? "desc" : "asc";
    params.set("order", `${order.column}.${direction}`);
  }
  if (typeof limit === "number") {
    params.set("limit", String(limit));
  }
  return params.toString();
}

export async function supabaseSelect(table, options = {}) {
  const query = buildQueryParams({ ...options, select: options.select ?? "*" });
  const path = query ? `${table}?${query}` : table;
  return request(path, { method: "GET" });
}

export async function supabaseUpsert(table, rows, { onConflict, returning = "minimal" } = {}) {
  if (!Array.isArray(rows)) throw new Error("Rows for upsert must be an array");
  if (!rows.length) return null;
  const params = new URLSearchParams();
  if (onConflict) params.set("on_conflict", onConflict);
  const path = params.toString() ? `${table}?${params}` : table;
  return request(path, {
    method: "POST",
    body: rows,
    headers: { Prefer: `resolution=merge-duplicates,return=${returning}` },
  });
}

export async function supabaseDelete(table, filters = []) {
  const query = buildQueryParams({ filters });
  const path = query ? `${table}?${query}` : table;
  return request(path, { method: "DELETE" });
}

export async function supabaseInsert(table, rows, { returning = "minimal" } = {}) {
  if (!Array.isArray(rows)) throw new Error("Rows for insert must be an array");
  if (!rows.length) return null;
  const path = `${table}`;
  return request(path, {
    method: "POST",
    body: rows,
    headers: { Prefer: `return=${returning}` },
  });
}

export function withWorkspace(rows) {
  if (!Array.isArray(rows)) return [];
  return rows.map((row) => ({ workspace_id: workspaceId, ...row }));
}
