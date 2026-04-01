import { isSupabaseConfigured, supabase } from "@/lib/supabase";
import { isSupabaseAdminConfigured, supabaseAdmin } from "@/lib/supabase-admin";

const DEMO_DEVICE_ID_STORAGE_KEY = "nextrade-demo-device-id";
const DEMO_WORKSPACES_TABLE = "demo_workspaces";
const USER_DEMO_WORKSPACES_TABLE = "user_demo_workspaces";

export type DemoWorkspaceOwnerType = "device" | "user";

export interface DemoProfileSnapshot {
  id: string;
  name: string;
  payload: string;
}

export interface DemoWorkspaceSnapshot {
  activeId: string;
  profiles: DemoProfileSnapshot[];
  walletMode: "demo" | "real";
  demoAutoPilot: boolean;
  autoPilotMode: "signals" | "dca";
  copyProfile: "conservative" | "balanced" | "aggressive";
}

export interface DemoWorkspaceLoadResult {
  ok: boolean;
  data: DemoWorkspaceSnapshot | null;
  updatedAt: string | null;
  error?: string;
}

export interface DemoWorkspaceSaveResult {
  ok: boolean;
  updatedAt: string | null;
  error?: string;
}

export interface DemoWorkspaceRecord {
  ownerType: DemoWorkspaceOwnerType;
  ownerId: string;
  snapshot: DemoWorkspaceSnapshot;
  updatedAt: string | null;
}

export interface DemoWorkspaceListResult {
  ok: boolean;
  data: DemoWorkspaceRecord[];
  error?: string;
}

function formatWorkspaceError(message: string) {
  if (
    (message.includes("demo_workspaces") ||
      message.includes("user_demo_workspaces")) &&
    (message.includes("schema cache") ||
      message.includes("does not exist") ||
      message.includes("relation"))
  ) {
    return "Missing Supabase table: create demo workspace tables in SQL Editor";
  }

  return message;
}

function normalizeSnapshot(
  raw: Partial<DemoWorkspaceSnapshot> | null | undefined,
): DemoWorkspaceSnapshot | null {
  if (!raw) return null;

  const profiles = Array.isArray(raw.profiles)
    ? raw.profiles.filter(
        (profile): profile is DemoProfileSnapshot =>
          Boolean(profile) &&
          typeof profile.id === "string" &&
          typeof profile.name === "string" &&
          typeof profile.payload === "string",
      )
    : [];

  if (profiles.length === 0) return null;

  const activeId =
    typeof raw.activeId === "string" &&
    profiles.some((profile) => profile.id === raw.activeId)
      ? raw.activeId
      : profiles[0].id;

  return {
    activeId,
    profiles,
    walletMode: raw.walletMode === "real" ? "real" : "demo",
    demoAutoPilot: raw.demoAutoPilot === true,
    autoPilotMode: raw.autoPilotMode === "dca" ? "dca" : "signals",
    copyProfile:
      raw.copyProfile === "conservative" || raw.copyProfile === "aggressive"
        ? raw.copyProfile
        : "balanced",
  };
}

export function getOrCreateDemoDeviceId() {
  if (typeof window === "undefined") return null;

  const existing = window.localStorage.getItem(DEMO_DEVICE_ID_STORAGE_KEY);
  if (existing) return existing;

  const nextId = crypto.randomUUID();
  window.localStorage.setItem(DEMO_DEVICE_ID_STORAGE_KEY, nextId);
  return nextId;
}

async function getAuthenticatedUserId() {
  if (!supabase) return null;

  const {
    data: { user },
  } = await supabase.auth.getUser();

  return user?.id ?? null;
}

async function resolveWorkspaceOwner() {
  const userId = await getAuthenticatedUserId();
  if (userId) {
    return {
      ownerType: "user" as const,
      ownerId: userId,
    };
  }

  const deviceId = getOrCreateDemoDeviceId();
  if (!deviceId) return null;

  return {
    ownerType: "device" as const,
    ownerId: deviceId,
  };
}

function getOwnerQueryParts(ownerType: DemoWorkspaceOwnerType) {
  return ownerType === "user"
    ? {
        table: USER_DEMO_WORKSPACES_TABLE,
        column: "user_id",
      }
    : {
        table: DEMO_WORKSPACES_TABLE,
        column: "device_id",
      };
}

export async function loadDemoWorkspaceFromSupabase(): Promise<DemoWorkspaceLoadResult> {
  if (!isSupabaseConfigured || !supabase) {
    return {
      ok: false,
      data: null,
      updatedAt: null,
      error: "Supabase is not configured",
    };
  }

  const owner = await resolveWorkspaceOwner();
  if (!owner) {
    return {
      ok: false,
      data: null,
      updatedAt: null,
      error: "Workspace owner is unavailable",
    };
  }

  const queryParts = getOwnerQueryParts(owner.ownerType);

  const { data, error } = await supabase
    .from(queryParts.table)
    .select("payload, updated_at")
    .eq(queryParts.column, owner.ownerId)
    .maybeSingle();

  if (error) {
    return {
      ok: false,
      data: null,
      updatedAt: null,
      error: formatWorkspaceError(error.message),
    };
  }

  return {
    ok: true,
    data: normalizeSnapshot(data?.payload as Partial<DemoWorkspaceSnapshot>),
    updatedAt: data?.updated_at ?? null,
  };
}

export async function saveDemoWorkspaceToSupabase(
  snapshot: DemoWorkspaceSnapshot,
): Promise<DemoWorkspaceSaveResult> {
  if (!isSupabaseConfigured || !supabase) {
    return {
      ok: false,
      updatedAt: null,
      error: "Supabase is not configured",
    };
  }

  const owner = await resolveWorkspaceOwner();
  if (!owner) {
    return {
      ok: false,
      updatedAt: null,
      error: "Workspace owner is unavailable",
    };
  }

  return saveDemoWorkspaceForOwner(owner.ownerType, owner.ownerId, snapshot);
}

async function listDeviceDemoWorkspaces() {
  const client = supabaseAdmin ?? supabase;
  if (!client) return [];

  const { data, error } = await client
    .from(DEMO_WORKSPACES_TABLE)
    .select("device_id, payload, updated_at");

  if (error) {
    throw new Error(formatWorkspaceError(error.message));
  }

  return (data ?? [])
    .map((row) => {
      const snapshot = normalizeSnapshot(
        row.payload as Partial<DemoWorkspaceSnapshot> | null,
      );
      if (!snapshot || typeof row.device_id !== "string") return null;

      return {
        ownerType: "device" as const,
        ownerId: row.device_id,
        snapshot,
        updatedAt: row.updated_at ?? null,
      } satisfies DemoWorkspaceRecord;
    })
    .filter((record): record is DemoWorkspaceRecord => record !== null);
}

async function listUserDemoWorkspaces() {
  if (!isSupabaseAdminConfigured || !supabaseAdmin) {
    return [];
  }

  const { data, error } = await supabaseAdmin
    .from(USER_DEMO_WORKSPACES_TABLE)
    .select("user_id, payload, updated_at");

  if (error) {
    throw new Error(formatWorkspaceError(error.message));
  }

  return (data ?? [])
    .map((row) => {
      const snapshot = normalizeSnapshot(
        row.payload as Partial<DemoWorkspaceSnapshot> | null,
      );
      if (!snapshot || typeof row.user_id !== "string") return null;

      return {
        ownerType: "user" as const,
        ownerId: row.user_id,
        snapshot,
        updatedAt: row.updated_at ?? null,
      } satisfies DemoWorkspaceRecord;
    })
    .filter((record): record is DemoWorkspaceRecord => record !== null);
}

export async function saveDemoWorkspaceForOwner(
  ownerType: DemoWorkspaceOwnerType,
  ownerId: string,
  snapshot: DemoWorkspaceSnapshot,
): Promise<DemoWorkspaceSaveResult> {
  const queryParts = getOwnerQueryParts(ownerType);
  const client =
    ownerType === "user"
      ? (supabaseAdmin ?? supabase)
      : (supabaseAdmin ?? supabase);

  if (!client) {
    return {
      ok: false,
      updatedAt: null,
      error: "Supabase client is unavailable",
    };
  }

  const updatedAt = new Date().toISOString();
  const { error } = await client.from(queryParts.table).upsert(
    {
      [queryParts.column]: ownerId,
      payload: snapshot,
      updated_at: updatedAt,
    },
    { onConflict: queryParts.column },
  );

  if (error) {
    return {
      ok: false,
      updatedAt: null,
      error: formatWorkspaceError(error.message),
    };
  }

  return {
    ok: true,
    updatedAt,
  };
}

export async function listDemoWorkspacesFromSupabase(): Promise<DemoWorkspaceListResult> {
  if (!isSupabaseConfigured || !supabase) {
    return {
      ok: false,
      data: [],
      error: "Supabase is not configured",
    };
  }

  try {
    const [deviceRecords, userRecords] = await Promise.all([
      listDeviceDemoWorkspaces(),
      listUserDemoWorkspaces(),
    ]);

    return {
      ok: true,
      data: [...deviceRecords, ...userRecords],
    };
  } catch (error) {
    return {
      ok: false,
      data: [],
      error:
        error instanceof Error
          ? error.message
          : "Unable to load demo workspaces",
    };
  }
}

export async function saveDemoWorkspaceForDevice(
  deviceId: string,
  snapshot: DemoWorkspaceSnapshot,
): Promise<DemoWorkspaceSaveResult> {
  return saveDemoWorkspaceForOwner("device", deviceId, snapshot);
}
