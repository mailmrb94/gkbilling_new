function normalizeSupabaseUrl(rawUrl) {
  const trimmed = (rawUrl || "").trim();
  if (!trimmed) return { url: "", isValid: false };

  let normalized = trimmed;
  if (!/^https?:\/\//i.test(normalized)) {
    normalized = `https://${normalized}`;
  }

  try {
    const url = new URL(normalized);
    const suffixes = ["supabase.co", "supabase.in", "supabase.net"];
    const lowerHost = url.hostname.toLowerCase();
    for (const suffix of suffixes) {
      if (lowerHost.endsWith(suffix) && !lowerHost.endsWith(`.${suffix}`)) {
        const prefix = url.hostname.slice(0, url.hostname.length - suffix.length);
        const trimmedPrefix = prefix.replace(/\.$/, "");
        const finalHost = trimmedPrefix ? `${trimmedPrefix}.${suffix}` : suffix;
        url.hostname = finalHost;
        break;
      }
    }
    return { url: url.origin.replace(/\/$/, ""), isValid: true };
  } catch (error) {
    return { url: normalized.replace(/\/$/, ""), isValid: false };
  }
}

const { url: supabaseUrl, isValid: isSupabaseUrlValid } = normalizeSupabaseUrl(
  import.meta.env.VITE_SUPABASE_URL,
);
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || "";
const workspaceId = import.meta.env.VITE_SUPABASE_WORKSPACE || "default";

const restBaseUrl = supabaseUrl ? `${supabaseUrl}/rest/v1` : "";

export const isSupabaseConfigured = Boolean(isSupabaseUrlValid && supabaseAnonKey);
export const supabaseUrlError = isSupabaseUrlValid
  ? null
  : import.meta.env.VITE_SUPABASE_URL
    ? "VITE_SUPABASE_URL must be the Supabase Project URL, e.g. https://xyzcompany.supabase.co"
    : null;
export const supabaseWorkspaceId = workspaceId;

function ensureConfigured() {
  if (!supabaseAnonKey) {
    throw new Error("Missing VITE_SUPABASE_ANON_KEY environment variable");
  }
  if (!isSupabaseUrlValid) {
    throw new Error(
      supabaseUrlError || "VITE_SUPABASE_URL is not a valid Supabase Project URL",
    );
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
