import { createContext, useContext, useEffect, useState } from "react";
import { call, native } from "@/lib/api";
import type { Preferences } from "@/lib/types";

const aiEnabledEvent = "anser-ai-enabled-changed";
export const AiEnabledContext = createContext(true);
export const useAiEnabled = () => useContext(AiEnabledContext);

export function useAiPreference(demo: boolean) {
  const [value, setValue] = useState<{ demo: boolean; enabled: boolean }>();
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    let live = true;
    let changed = false;
    let unlisten: (() => void) | undefined;
    function update(enabled: boolean) {
      if (live) setValue({ demo, enabled });
    }
    async function load() {
      if (native && !demo) {
        try {
          const { listen } = await import("@tauri-apps/api/event");
          const stop = await listen<boolean>(aiEnabledEvent, ({ payload }) => {
            changed = true;
            update(payload);
          });
          if (live) unlisten = stop;
          else stop();
        } catch {
          // The preference remains readable if the native event listener fails.
        }
      }
      if (!live) return;
      const preferences = await call<Preferences>("get_preferences");
      if (!changed) update(preferences.aiEnabled ?? true);
    }
    void load().catch(() => {});
    return () => {
      live = false;
      unlisten?.();
    };
  }, [demo]);

  async function change(enabled: boolean) {
    setSaving(true);
    try {
      await call("set_ai_enabled", { enabled });
      setValue({ demo, enabled });
    } finally {
      setSaving(false);
    }
  }

  const ready = value?.demo === demo;
  return { enabled: ready && value.enabled, ready, saving, change };
}
