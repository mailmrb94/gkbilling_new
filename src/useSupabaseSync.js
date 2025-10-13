import { useCallback, useEffect, useRef, useState } from "react";
import {
  isSupabaseConfigured,
  supabaseDelete,
  supabaseSelect,
  supabaseUpsert,
  supabaseWorkspaceId,
  withWorkspace,
} from "./supabaseClient";

function nowIso() {
  return new Date().toISOString();
}

export function useSupabaseSync({
  table,
  state,
  setState,
  identity,
  fromRow,
  toRow,
  conflictTarget,
  orderBy,
}) {
  const [status, setStatus] = useState({
    available: isSupabaseConfigured,
    loading: Boolean(isSupabaseConfigured),
    syncing: false,
    error: null,
    lastSyncedAt: null,
  });

  const skipNextSyncRef = useRef(false);
  const knownIdsRef = useRef(new Set());
  const loadedRef = useRef(false);

  const loadFromRemote = useCallback(async () => {
    if (!isSupabaseConfigured) {
      setStatus((prev) => ({ ...prev, available: false, loading: false }));
      return { data: null };
    }
    setStatus((prev) => ({ ...prev, loading: true, error: null }));
    try {
      const filters = [
        { column: "workspace_id", operator: "eq", value: supabaseWorkspaceId },
      ];
      const order = orderBy
        ? { column: orderBy.column, ascending: orderBy.ascending }
        : undefined;
      const data = await supabaseSelect(table, { filters, order });
      const mapped = Array.isArray(data) ? data.map(fromRow) : [];
      knownIdsRef.current = new Set(mapped.map(identity));
      skipNextSyncRef.current = true;
      setState(mapped);
      loadedRef.current = true;
      const timestamp = nowIso();
      setStatus((prev) => ({
        ...prev,
        available: true,
        loading: false,
        lastSyncedAt: timestamp,
      }));
      return { data: mapped };
    } catch (error) {
      console.error("Supabase load failed", error);
      setStatus((prev) => ({
        ...prev,
        loading: false,
        error: error?.message || String(error),
      }));
      return { error };
    }
  }, [fromRow, identity, orderBy, setState, table]);

  useEffect(() => {
    loadFromRemote();
  }, [loadFromRemote]);

  useEffect(() => {
    if (!isSupabaseConfigured) return;
    if (!loadedRef.current) return;
    if (skipNextSyncRef.current) {
      skipNextSyncRef.current = false;
      return;
    }
    const currentIds = new Set(state.map(identity));
    const removedIds = [...knownIdsRef.current].filter((id) => !currentIds.has(id));
    const rows = withWorkspace(state.map((item) => toRow(item)));
    rows.forEach((row) => {
      row.updated_at = row.updated_at || nowIso();
    });
    const performSync = async () => {
      setStatus((prev) => ({ ...prev, syncing: true, error: null }));
      try {
        if (rows.length) {
          await supabaseUpsert(table, rows, {
            onConflict: conflictTarget,
            returning: "minimal",
          });
        }
        if (removedIds.length) {
          await supabaseDelete(table, [
            { column: "workspace_id", operator: "eq", value: supabaseWorkspaceId },
            { column: "uid", operator: "in", value: removedIds },
          ]);
        } else if (!rows.length) {
          // Nothing to upsert and nothing removed, but ensure old rows cleared if state empty
          if (knownIdsRef.current.size) {
            await supabaseDelete(table, [
              { column: "workspace_id", operator: "eq", value: supabaseWorkspaceId },
            ]);
          }
        }
        knownIdsRef.current = currentIds;
        const timestamp = nowIso();
        setStatus((prev) => ({
          ...prev,
          syncing: false,
          lastSyncedAt: timestamp,
        }));
      } catch (error) {
        console.error("Supabase sync failed", error);
        setStatus((prev) => ({
          ...prev,
          syncing: false,
          error: error?.message || String(error),
        }));
      }
    };
    performSync();
  }, [conflictTarget, state, table, toRow, identity]);

  return {
    ...status,
    refresh: loadFromRemote,
  };
}
