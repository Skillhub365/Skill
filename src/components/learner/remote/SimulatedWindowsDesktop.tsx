import { useEffect, useMemo, useState } from "react";
import {
  Chrome,
  Folder,
  HardDrive,
  LayoutGrid,
  Minus,
  Search,
  Settings,
  Square,
  Terminal as TerminalIcon,
  Trash2,
  Volume2,
  Wifi,
  X,
} from "lucide-react";

type AppId = "explorer" | "terminal" | "browser" | "settings";

interface AppDef {
  id: AppId;
  name: string;
  icon: typeof Folder;
}

const APPS: AppDef[] = [
  { id: "explorer", name: "File Explorer", icon: Folder },
  { id: "terminal", name: "Terminal", icon: TerminalIcon },
  { id: "browser", name: "Edge", icon: Chrome },
  { id: "settings", name: "Settings", icon: Settings },
];

const DESKTOP_ICONS: { name: string; icon: typeof Folder; app?: AppId }[] = [
  { name: "This PC", icon: HardDrive, app: "explorer" },
  { name: "Lab Files", icon: Folder, app: "explorer" },
  { name: "Terminal", icon: TerminalIcon, app: "terminal" },
  { name: "Edge", icon: Chrome, app: "browser" },
  { name: "Recycle Bin", icon: Trash2 },
];

const WINDOW_POS: Record<AppId, string> = {
  explorer: "left-[6%] top-[8%] h-[62%] w-[62%]",
  terminal: "left-[24%] top-[26%] h-[54%] w-[58%]",
  browser: "left-[14%] top-[14%] h-[70%] w-[70%]",
  settings: "left-[30%] top-[20%] h-[52%] w-[46%]",
};

export function SimulatedWindowsDesktop({ machineName, userName }: { machineName: string; userName: string }) {
  const [open, setOpen] = useState<AppId[]>(["explorer"]);
  const [focused, setFocused] = useState<AppId | null>("explorer");
  const [startOpen, setStartOpen] = useState(false);
  const [clock, setClock] = useState(() => new Date());

  useEffect(() => {
    const id = window.setInterval(() => setClock(new Date()), 15_000);
    return () => window.clearInterval(id);
  }, []);

  const launch = (app: AppId) => {
    setOpen((prev) => (prev.includes(app) ? prev : [...prev, app]));
    setFocused(app);
    setStartOpen(false);
  };
  const close = (app: AppId) => {
    setOpen((prev) => prev.filter((a) => a !== app));
    setFocused((f) => (f === app ? null : f));
  };

  const time = useMemo(
    () => clock.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
    [clock],
  );
  const date = useMemo(() => clock.toLocaleDateString([], { day: "2-digit", month: "2-digit", year: "numeric" }), [clock]);

  return (
    <div
      className="vm-desktop relative size-full select-none overflow-hidden font-sans text-[13px]"
      style={{ background: "var(--vm-wallpaper)", color: "var(--vm-ink)" }}
      onClick={() => setStartOpen(false)}
    >
      {/* Desktop icons */}
      <div className="absolute left-3 top-3 grid w-24 gap-1">
        {DESKTOP_ICONS.map((icon) => (
          <button
            key={icon.name}
            type="button"
            onDoubleClick={() => icon.app && launch(icon.app)}
            onClick={(e) => e.stopPropagation()}
            className="flex flex-col items-center gap-1 rounded p-2 text-center text-[11px] leading-tight text-white/90 hover:bg-white/10 focus:bg-white/15 focus:outline-none"
          >
            <icon.icon className="size-7 drop-shadow" strokeWidth={1.5} />
            {icon.name}
          </button>
        ))}
      </div>

      {/* Windows */}
      {open.map((app) => {
        const def = APPS.find((a) => a.id === app)!;
        return (
          <div
            key={app}
            onMouseDown={() => setFocused(app)}
            onClick={(e) => e.stopPropagation()}
            className={`absolute flex flex-col overflow-hidden rounded-lg shadow-2xl ring-1 ring-black/20 ${WINDOW_POS[app]}`}
            style={{
              background: "var(--vm-surface)",
              zIndex: focused === app ? 30 : 20,
              opacity: focused === app ? 1 : 0.97,
            }}
          >
            <div
              className="flex h-9 shrink-0 items-center justify-between px-3"
              style={{ background: "var(--vm-surface-2)", borderBottom: "1px solid var(--vm-line)" }}
            >
              <div className="flex items-center gap-2 text-[12px] font-medium">
                <def.icon className="size-4" style={{ color: "var(--vm-accent)" }} />
                {def.name}
              </div>
              <div className="flex items-center gap-1">
                <TitleButton onClick={() => close(app)} label="Minimize"><Minus className="size-3" /></TitleButton>
                <TitleButton label="Maximize"><Square className="size-2.5" /></TitleButton>
                <TitleButton onClick={() => close(app)} label="Close" danger><X className="size-3" /></TitleButton>
              </div>
            </div>
            <div className="min-h-0 flex-1 overflow-auto">
              {app === "explorer" && <ExplorerBody machineName={machineName} userName={userName} />}
              {app === "terminal" && <TerminalBody machineName={machineName} userName={userName} />}
              {app === "browser" && <BrowserBody />}
              {app === "settings" && <SettingsBody machineName={machineName} />}
            </div>
          </div>
        );
      })}

      {/* Start menu */}
      {startOpen && (
        <div
          onClick={(e) => e.stopPropagation()}
          className="absolute bottom-14 left-1/2 z-40 w-[420px] -translate-x-1/2 rounded-xl p-4 shadow-2xl ring-1 ring-black/20"
          style={{ background: "var(--vm-surface)" }}
        >
          <div className="flex items-center gap-2 rounded-md px-3 py-2" style={{ background: "var(--vm-surface-2)" }}>
            <Search className="size-4" style={{ color: "var(--vm-ink-muted)" }} />
            <span className="text-[12px]" style={{ color: "var(--vm-ink-muted)" }}>Type here to search</span>
          </div>
          <p className="mt-4 text-[11px] font-semibold uppercase tracking-wide" style={{ color: "var(--vm-ink-muted)" }}>
            Pinned
          </p>
          <div className="mt-2 grid grid-cols-4 gap-2">
            {APPS.map((a) => (
              <button
                key={a.id}
                type="button"
                onClick={() => launch(a.id)}
                className="flex flex-col items-center gap-1.5 rounded-lg p-3 text-[11px] hover:bg-black/5"
              >
                <a.icon className="size-6" style={{ color: "var(--vm-accent)" }} strokeWidth={1.5} />
                {a.name}
              </button>
            ))}
          </div>
          <p className="mt-4 border-t pt-3 text-[11px]" style={{ borderColor: "var(--vm-line)", color: "var(--vm-ink-muted)" }}>
            Signed in to {machineName} as {userName}
          </p>
        </div>
      )}

      {/* Taskbar */}
      <div
        className="absolute inset-x-0 bottom-0 z-40 flex h-11 items-center justify-between px-3 backdrop-blur-md"
        style={{ background: "var(--vm-taskbar)" }}
      >
        <div className="flex flex-1 items-center justify-center gap-1">
          <button
            type="button"
            aria-label="Start"
            onClick={(e) => {
              e.stopPropagation();
              setStartOpen((v) => !v);
            }}
            className={`rounded p-2 text-white/90 hover:bg-white/15 ${startOpen ? "bg-white/20" : ""}`}
          >
            <LayoutGrid className="size-4" />
          </button>
          {APPS.map((a) => (
            <button
              key={a.id}
              type="button"
              aria-label={a.name}
              onClick={(e) => {
                e.stopPropagation();
                launch(a.id);
              }}
              className={`relative rounded p-2 text-white/90 hover:bg-white/15 ${focused === a.id ? "bg-white/20" : ""}`}
            >
              <a.icon className="size-4" />
              {open.includes(a.id) && (
                <span className="absolute inset-x-2 bottom-0.5 h-0.5 rounded-full bg-white/80" />
              )}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-3 text-[11px] text-white/85">
          <Wifi className="size-3.5" />
          <Volume2 className="size-3.5" />
          <div className="text-right leading-tight">
            <div>{time}</div>
            <div>{date}</div>
          </div>
        </div>
      </div>
    </div>
  );
}

function TitleButton({
  children,
  onClick,
  label,
  danger,
}: {
  children: React.ReactNode;
  onClick?: () => void;
  label: string;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      className={`grid size-6 place-items-center rounded ${danger ? "hover:bg-red-500 hover:text-white" : "hover:bg-black/10"}`}
    >
      {children}
    </button>
  );
}

function ExplorerBody({ machineName, userName }: { machineName: string; userName: string }) {
  const files = [
    { name: "lab-instructions.pdf", type: "PDF Document", size: "412 KB" },
    { name: "deploy.ps1", type: "PowerShell Script", size: "6 KB" },
    { name: "sample-data.csv", type: "CSV File", size: "88 KB" },
    { name: "src", type: "File folder", size: "—" },
    { name: "azure-openai.env", type: "ENV File", size: "1 KB" },
  ];
  return (
    <div className="flex h-full">
      <aside className="w-44 shrink-0 p-3 text-[12px]" style={{ background: "var(--vm-surface-2)" }}>
        <p className="font-semibold">Quick access</p>
        <ul className="mt-2 space-y-1.5" style={{ color: "var(--vm-ink-muted)" }}>
          <li>Desktop</li>
          <li>Documents</li>
          <li className="font-medium" style={{ color: "var(--vm-accent)" }}>Lab Files</li>
          <li>Downloads</li>
        </ul>
        <p className="mt-4 font-semibold">This PC</p>
        <ul className="mt-2 space-y-1.5" style={{ color: "var(--vm-ink-muted)" }}>
          <li>Windows (C:)</li>
          <li>Lab Data (D:)</li>
        </ul>
      </aside>
      <div className="min-w-0 flex-1">
        <div className="px-4 py-2 text-[12px]" style={{ borderBottom: "1px solid var(--vm-line)", color: "var(--vm-ink-muted)" }}>
          C:\Users\{userName.split(" ")[0]?.toLowerCase()}\LabFiles — {machineName}
        </div>
        <table className="w-full text-[12px]">
          <thead style={{ color: "var(--vm-ink-muted)" }}>
            <tr>
              <th className="px-4 py-2 text-left font-medium">Name</th>
              <th className="px-4 py-2 text-left font-medium">Type</th>
              <th className="px-4 py-2 text-right font-medium">Size</th>
            </tr>
          </thead>
          <tbody>
            {files.map((f) => (
              <tr key={f.name} className="hover:bg-black/5">
                <td className="flex items-center gap-2 px-4 py-1.5">
                  <Folder className="size-3.5" style={{ color: "var(--vm-accent)" }} />
                  {f.name}
                </td>
                <td className="px-4 py-1.5" style={{ color: "var(--vm-ink-muted)" }}>{f.type}</td>
                <td className="px-4 py-1.5 text-right" style={{ color: "var(--vm-ink-muted)" }}>{f.size}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function TerminalBody({ machineName, userName }: { machineName: string; userName: string }) {
  const prompt = `PS C:\\Users\\${userName.split(" ")[0]?.toLowerCase()}>`;
  const [lines, setLines] = useState<string[]>([
    "Windows PowerShell",
    "Copyright (C) Microsoft Corporation. All rights reserved.",
    "",
    `${prompt} hostname`,
    machineName,
    "",
  ]);
  const [value, setValue] = useState("");

  const run = (cmd: string) => {
    const out: Record<string, string[]> = {
      hostname: [machineName],
      whoami: [`${machineName}\\${userName.split(" ")[0]?.toLowerCase()}`],
      dir: ["lab-instructions.pdf", "deploy.ps1", "sample-data.csv", "src"],
      "az --version": ["azure-cli 2.62.0", "core 2.62.0"],
      cls: [],
    };
    if (cmd === "cls") {
      setLines([]);
      return;
    }
    setLines((prev) => [
      ...prev,
      `${prompt} ${cmd}`,
      ...(out[cmd] ?? [`'${cmd}' is not recognized as an internal or external command.`]),
      "",
    ]);
  };

  return (
    <div className="h-full overflow-auto p-3 font-mono text-[12px] leading-relaxed" style={{ background: "var(--vm-terminal)", color: "var(--vm-terminal-ink)" }}>
      {lines.map((l, i) => (
        <div key={i} className="whitespace-pre-wrap">{l}</div>
      ))}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (!value.trim()) return;
          run(value.trim());
          setValue("");
        }}
        className="flex items-center gap-2"
      >
        <span>{prompt}</span>
        <input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          aria-label="Remote terminal input"
          className="flex-1 bg-transparent outline-none"
          spellCheck={false}
          autoComplete="off"
        />
      </form>
    </div>
  );
}

function BrowserBody() {
  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 px-3 py-2" style={{ background: "var(--vm-surface-2)", borderBottom: "1px solid var(--vm-line)" }}>
        <span className="rounded-full px-3 py-1 text-[11px]" style={{ background: "var(--vm-surface)", color: "var(--vm-ink-muted)" }}>
          https://portal.azure.com
        </span>
      </div>
      <div className="flex flex-1 flex-col items-center justify-center gap-2 text-center">
        <Chrome className="size-8" style={{ color: "var(--vm-accent)" }} />
        <p className="text-[13px] font-semibold">Browser running inside the lab VM</p>
        <p className="max-w-sm text-[12px]" style={{ color: "var(--vm-ink-muted)" }}>
          Outbound traffic from this machine is routed through the lab network, so learners never touch the
          Azure portal from their own device.
        </p>
      </div>
    </div>
  );
}

function SettingsBody({ machineName }: { machineName: string }) {
  const rows = [
    ["Device name", machineName],
    ["Edition", "Windows Server 2022 Datacenter"],
    ["Processor", "4 vCPU · 16 GB RAM"],
    ["Remote Desktop", "Enabled (gateway only)"],
    ["Network", "Private virtual network — no public IP"],
  ];
  return (
    <div className="p-5 text-[12px]">
      <p className="text-[14px] font-semibold">System · About</p>
      <dl className="mt-4 space-y-2">
        {rows.map(([k, v]) => (
          <div key={k} className="flex justify-between gap-4 border-b pb-2" style={{ borderColor: "var(--vm-line)" }}>
            <dt style={{ color: "var(--vm-ink-muted)" }}>{k}</dt>
            <dd className="text-right font-medium">{v}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}