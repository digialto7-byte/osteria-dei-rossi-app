"use client";

import { useEffect } from "react";
import { TENANT_SWITCH_CHANNEL, tabId } from "@/lib/tenancy/switch";

interface ChannelLike {
  onmessage: ((event: { data: unknown }) => void) | null;
  close(): void;
}

export interface ListenerDeps {
  /** Opens the channel; null in a browser without BroadcastChannel (the plan's residual risk R5). */
  open: ((name: string) => ChannelLike) | null;
  /** A full document load of `path`. */
  load: (path: string) => void;
  /** This tab's id: its own message is not obeyed. */
  selfId: string;
}

function defaultDeps(): ListenerDeps {
  return {
    open:
      typeof BroadcastChannel === "undefined"
        ? null
        : (name) => new BroadcastChannel(name) as ChannelLike,
    load: (path) => window.location.assign(path),
    selfId: tabId(),
  };
}

/** True for `{ type: "switched", from: <string> }` sent by another tab. */
function isSwitchedFromElsewhere(data: unknown, selfId: string): boolean {
  if (data === null || typeof data !== "object") return false;
  const { type, from } = data as { type?: unknown; from?: unknown };
  return type === "switched" && typeof from === "string" && from !== selfId;
}

/**
 * Another tab changed venue (SP2 §3.5, "Other tabs"): tabs share the session cookie, so without this a second tab would show the old venue's screen
 * while its next request runs in the new one. Mounted once, in the app shell. A full load of `/`, so nothing of the old venue stays on screen.
 */
export function useTenantSwitchListener(deps?: ListenerDeps): void {
  useEffect(() => {
    const { open, load, selfId } = deps ?? defaultDeps();
    if (open === null) return;
    const channel = open(TENANT_SWITCH_CHANNEL);
    channel.onmessage = (event) => {
      if (isSwitchedFromElsewhere(event.data, selfId)) load("/");
    };
    return () => {
      channel.onmessage = null;
      channel.close();
    };
  }, [deps]);
}
