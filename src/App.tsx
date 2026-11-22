import { useEffect, useMemo, useRef, useState } from "react";
import {
  Download,
  Upload,
  Plug,
  Unplug,
  FileDown,
  FileUp,
  Trash2,
  Radio,
  Square,
  Terminal,
  ShieldAlert,
  ChevronRight,
  X,
  ListPlus,
} from "lucide-react";
import { applyNlPresets } from "./lib/nl-presets";
import {
  R10CloneLink,
  MODES,
  IMAGE_SIZE,
  decodeChannels,
  patchChannels,
  assertRange,
  encodeFrequency,
  type CloneImage,
  type Channel,
  type Mode,
} from "./lib/r10-clone";

const TOTAL = 1000;
const CHANNELS_PER_BANK = 50;
const BANKS = Array.from({ length: 20 }, (_, i) => String.fromCharCode(65 + i));
const KEY = "r10-channels";

const blank = (loc: number): Channel => ({
  loc,
  name: "",
  freq: "",
  mode: "FM",
  skip: false,
  comment: "",
});

function validateFreqInput(freq: string): string | null {
  const trimmed = freq.trim();
  if (!trimmed) return null;
  try {
    encodeFrequency(trimmed);
    return null;
  } catch (e) {
    return e instanceof Error ? e.message : "Invalid frequency";
  }
}

interface ConfirmState {
  title: string;
  message: string;
  confirmLabel: string;
  tone: "primary" | "emerald" | "danger";
  onConfirm: () => void;
}

export default function App() {
  const [rows, setRows] = useState<Channel[]>(() => applyNlPresets());
  const [activeTab, setActiveTab] = useState<"memories" | "clone" | "log">("memories");
  const [selectedBank, setSelectedBank] = useState<number>(0);
  const [modeFilter, setModeFilter] = useState<string>("ALL");
  const [sel, setSel] = useState<number>(0);

  // Web Serial & Clone state
  const [link, setLink] = useState<R10CloneLink | null>(null);
  const [image, setImage] = useState<CloneImage | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const [storageReady, setStorageReady] = useState(false);
  const [range, setRange] = useState({ from: 0, to: 49 });
  const [status, setStatus] = useState("OPC-478 · NO INTERFACE");
  const [busy, setBusy] = useState<{ done: number; total: number; label: string } | null>(null);
  const [log, setLog] = useState<string[]>([]);
  const [serialOk, setSerialOk] = useState(true);
  const [confirmState, setConfirmState] = useState<ConfirmState | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const addLog = (s: string) =>
    setLog((l) => [...l.slice(-200), `${new Date().toLocaleTimeString()}  ${s}`]);

  useEffect(() => {
    setSerialOk("serial" in navigator);
    const s = localStorage.getItem(KEY);
    if (s) {
      try {
        const parsed = JSON.parse(s);
        if (
          Array.isArray(parsed) &&
          parsed.length === TOTAL &&
          parsed.some((c) => typeof c?.freq === "string" && c.freq.trim() !== "")
        ) {
          setRows(parsed);
        }
      } catch {
        /* ignore corrupt storage */
      }
    }
    setStorageReady(true);
  }, []);

  useEffect(() => {
    if (storageReady) {
      localStorage.setItem(KEY, JSON.stringify(rows));
    }
  }, [rows, storageReady]);

  // Synchroniseer de upload/download range automatisch met de gekozen Bank
  const selectBank = (bankIndex: number) => {
    setSelectedBank(bankIndex);
    const start = bankIndex * CHANNELS_PER_BANK;
    setRange({ from: start, to: start + CHANNELS_PER_BANK - 1 });
    setSel(start);
  };

  const upd = (loc: number, p: Partial<Channel>) =>
    setRows((r) => r.map((c) => (c.loc === loc ? { ...c, ...p } : c)));

  function requestLoadPresets() {
    if (busy) return;
    setConfirmState({
      title: "Presets Bank A t/m F laden",
      message:
        "Hiermee worden Bank A (27MC + Alpha), Bank B & C (LPD + PMR446), Bank D (Beek/Maastricht EHBK), Bank E (Eindhoven EHEH) en Bank F (Militair Limburg) gevuld met de standaardfrequenties.\n\nBank G t/m T blijven ongewijzigd.",
      confirmLabel: "Presets laden",
      tone: "primary",
      onConfirm: () => {
        setConfirmState(null);
        setRows((prev) => applyNlPresets(prev));
        setStatus("Presets geladen in Bank A t/m F (224 kanalen)");
        addLog("Standaardfrequenties geladen in Bank A t/m F.");
      },
    });
  }

  // --- OPC-478 CONNECTIE & CLONE LOGICA ---
  async function connect() {
    if (busy) return;
    if (link) {
      try {
        await link.close();
      } catch (e) {
        addLog(String(e));
      }
      setLink(null);
      setImage(null);
      setStatus("Disconnected");
      return;
    }
    const l = new R10CloneLink(addLog);
    try {
      await l.open();
      setLink(l);
      setImage(null);
      setStatus("Port open · OPC-478 cloning · 9600 baud · radio not yet verified");
    } catch (e) {
      await l.close().catch(() => {});
      setStatus("Connect failed");
      addLog(String(e));
    }
  }

  function saveBackup() {
    if (!image) return;
    const url = URL.createObjectURL(
      new Blob([image.data.slice().buffer], { type: "application/octet-stream" })
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = "IC-R10-original-clone.bin";
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    addLog("Saved IC-R10-original-clone.bin backup.");
  }

  function requestUpload() {
    if (!link || !image || busy) return;
    let patched: CloneImage;
    try {
      patched = patchChannels(image, rows, range.from, range.to);
    } catch (e) {
      setStatus("Upload not started");
      addLog((e as Error).message);
      return;
    }

    setConfirmState({
      title: `Upload channels ${range.from}–${range.to}`,
      message: `Upload channels ${range.from}–${range.to}? Blank cells in this range will clear those memories. Other channels and scanner settings are preserved.\n\nSave a clone backup first. Power the IC-R10 off, hold V/M while powering on for 1 second to show CLONE MODE. Connect OPC-478 to the external speaker [SP] jack. Do not press FUNC for upload. Keep power and cable connected until the scanner confirms completion.`,
      confirmLabel: "Start Upload",
      tone: "emerald",
      onConfirm: () => {
        setConfirmState(null);
        void executeUpload(patched);
      },
    });
  }

  async function executeUpload(patched: CloneImage) {
    if (!link) return;
    setBusy({ done: 0, total: IMAGE_SIZE, label: "Uploading bytes" });
    try {
      await link.upload(patched, (done, total) =>
        setBusy({ done, total, label: "Uploading bytes" })
      );
      setImage(null);
      setStatus("Upload confirmed by IC-R10 · power off/on · download again before another upload");
    } catch (e) {
      setImage(null);
      setStatus("Upload failed · download again before another upload");
      addLog((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  function requestDownload() {
    if (!link || busy) return;
    try {
      assertRange(range.from, range.to);
    } catch (e) {
      setStatus("Download not started");
      addLog((e as Error).message);
      return;
    }

    setConfirmState({
      title: `Download channels ${range.from}–${range.to}`,
      message: `Download will replace editor channels ${range.from}–${range.to}. Export CSV first to keep unsaved edits.\n\nConnect OPC-478 to the external speaker [SP] jack. Power off, then hold V/M while powering on for 1 second until CLONE MODE appears. Click Start Download here, then press FUNC on the IC-R10 to start sending.`,
      confirmLabel: "Start Download",
      tone: "primary",
      onConfirm: () => {
        setConfirmState(null);
        void executeDownload();
      },
    });
  }

  async function executeDownload() {
    if (!link) return;
    const controller = new AbortController();
    abortRef.current = controller;
    setImage(null);
    setBusy({ done: 0, total: IMAGE_SIZE, label: "Waiting for FUNC / downloading bytes" });
    setStatus("Press FUNC on the IC-R10 now · waiting for clone stream");
    try {
      const downloaded = await link.download(
        (done, total) => setBusy({ done, total, label: "Downloading bytes" }),
        controller.signal
      );
      const channels = decodeChannels(downloaded);
      setRows((current) =>
        current.map((row) => {
          const incoming = channels[row.loc];
          return incoming && row.loc >= range.from && row.loc <= range.to
            ? { ...incoming, comment: row.comment }
            : row;
        })
      );
      setImage(downloaded);
      addLog(
        `Complete IC-R10 image received (${downloaded.data.length} bytes); channels ${range.from}–${range.to} loaded.`
      );
      setStatus(
        "Download verified · save clone backup before upload · restart radio in CLONE MODE to upload"
      );
    } catch (e) {
      setStatus("Download stopped · channels unchanged");
      addLog((e as Error).message);
    } finally {
      abortRef.current = null;
      setBusy(null);
    }
  }

  // --- CSV IMPORT / EXPORT ---
  function exportCsv() {
    const head =
      "Location,Name,Frequency,Duplex,Offset,Tone,rToneFreq,cToneFreq,DtcsCode,DtcsPolarity,Mode,TStep,Skip,Comment";
    const lines = rows
      .filter((c) => c.freq)
      .map((c) =>
        [
          c.loc,
          c.name,
          c.freq,
          "",
          "0.000000",
          "",
          "88.5",
          "88.5",
          "023",
          "NN",
          c.mode,
          "5.00",
          c.skip ? "S" : "",
          `"${c.comment.replace(/"/g, "'")}"`,
        ].join(",")
      );
    const url = URL.createObjectURL(new Blob([[head, ...lines].join("\n")], { type: "text/csv" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = "Icom_IC-R10.csv";
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    addLog(`Exported ${lines.length} programmed channels to Icom_IC-R10.csv.`);
  }

  async function importCsv(f: File) {
    const [h, ...ls] = (await f.text()).split(/\r?\n/).filter(Boolean);
    const cols = (h ?? "").split(",");
    const ix = (n: string) => cols.indexOf(n);
    const next = Array.from({ length: TOTAL }, (_, i) => blank(i));
    let importedCount = 0;
    for (const l of ls) {
      const v =
        l
          .match(/("[^"]*"|[^,]*)(,|$)/g)
          ?.map((x) => x.replace(/,$/, "").replace(/^"|"$/g, "")) ?? [];
      const loc = parseInt(v[ix("Location")] ?? "", 10);
      if (isNaN(loc) || loc < 0 || loc >= TOTAL) continue;
      const m = v[ix("Mode")] as Mode;
      const freq = (v[ix("Frequency")] ?? "").trim();
      next[loc] = {
        loc,
        name: (v[ix("Name")] ?? "").slice(0, 8),
        freq,
        mode: MODES.includes(m) ? m : "FM",
        skip: v[ix("Skip")] === "S",
        comment: v[ix("Comment")] ?? "",
      };
      if (freq) importedCount++;
    }
    setRows(next);
    setStatus(`Imported ${f.name} (${importedCount} channels)`);
    addLog(`Imported ${f.name} (${importedCount} programmed channels).`);
  }

  function requestClearCurrentBank() {
    const start = selectedBank * CHANNELS_PER_BANK;
    const end = start + CHANNELS_PER_BANK - 1;
    setConfirmState({
      title: `Clear Bank ${BANKS[selectedBank]}`,
      message: `Clear all 50 channels in Bank ${BANKS[selectedBank]} (${start}–${end})? This cannot be undone unless you have a CSV or .bin backup.`,
      confirmLabel: `Clear Bank ${BANKS[selectedBank]}`,
      tone: "danger",
      onConfirm: () => {
        setConfirmState(null);
        setRows((prev) => prev.map((c) => (c.loc >= start && c.loc <= end ? blank(c.loc) : c)));
        setStatus(`Cleared Bank ${BANKS[selectedBank]} (${start}–${end})`);
      },
    });
  }

  // --- BEREKENINGEN VOOR DE BANK-WEERGAVE ---
  const bankChannels = useMemo(() => {
    const start = selectedBank * CHANNELS_PER_BANK;
    return rows.slice(start, start + CHANNELS_PER_BANK);
  }, [rows, selectedBank]);

  const filledInBank = useMemo(
    () => bankChannels.filter((c) => c.freq.trim() !== "").length,
    [bankChannels]
  );

  const totalFilled = useMemo(
    () => rows.filter((c) => c.freq.trim() !== "").length,
    [rows]
  );

  const modeCounts = useMemo(() => {
    const counts: Record<string, number> = { ALL: filledInBank };
    MODES.forEach((m) => (counts[m] = 0));
    bankChannels.forEach((c) => {
      if (c.freq.trim()) counts[c.mode] = (counts[c.mode] || 0) + 1;
    });
    return counts;
  }, [bankChannels, filledInBank]);

  const visibleChannels = useMemo(() => {
    if (modeFilter === "ALL") return bankChannels;
    return bankChannels.filter((c) => c.freq.trim() !== "" && c.mode === modeFilter);
  }, [bankChannels, modeFilter]);

  const bankStart = selectedBank * CHANNELS_PER_BANK;
  const bankEnd = bankStart + CHANNELS_PER_BANK - 1;

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-[#111317] text-zinc-100 select-none">
      {/* TOP NAVIGATION BAR */}
      <header className="flex h-12 shrink-0 items-center justify-between gap-8 border-b border-zinc-800/90 bg-[#16191f] px-4">
        <div className="flex items-center gap-3 shrink-0">
          <Radio className="h-4 w-4 text-blue-400" />
          <span className="text-sm font-semibold tracking-tight text-white whitespace-nowrap shrink-0">
            R-10 Programmer
          </span>
        </div>

        <nav className="flex items-center gap-1" aria-label="Primary sections">
          {(
            [
              { id: "memories", label: "Memories" },
              { id: "clone", label: "Clone & Setup" },
              { id: "log", label: `Serial Log (${log.length})` },
            ] as const
          ).map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              className={`rounded-md px-3 py-1.5 text-xs font-medium whitespace-nowrap shrink-0 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${
                activeTab === tab.id
                  ? "bg-zinc-800 text-white"
                  : "text-zinc-400 hover:bg-zinc-800/50 hover:text-zinc-200"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </nav>

        <div className="hidden sm:flex items-center gap-2 font-mono text-xs tabular-nums text-zinc-400 whitespace-nowrap shrink-0">
          <span>{totalFilled}/1000 total</span>
          <span aria-hidden="true" className="text-zinc-600">
            ·
          </span>
          <span>
            {filledInBank}/50 in Bank {BANKS[selectedBank]}
          </span>
        </div>
      </header>

      {/* WARNING BANNER INDIEN GEEN WEB SERIAL */}
      {!serialOk && (
        <div className="flex shrink-0 items-center gap-2.5 border-b border-amber-800/50 bg-amber-950/40 px-4 py-2 text-xs text-amber-200">
          <ShieldAlert className="h-4 w-4 shrink-0 text-amber-400" />
          <span>
            Web Serial API wordt niet ondersteund in deze browser. Gebruik Chrome of Edge op desktop
            om met de OPC-478 kabel te verbinden.
          </span>
        </div>
      )}

      {/* MAIN WORKSPACE */}
      <div className="flex min-h-0 flex-1 overflow-hidden">
        {/* LEFT SIDEBAR (OPC-478 + MEMORY BANKS) */}
        <aside className="flex w-64 shrink-0 flex-col border-r border-zinc-800/90 bg-[#15181e]">
          {/* OPC-478 CONNECTION BOX */}
          <div className="border-b border-zinc-800/90 p-3.5">
            <div className="mb-2.5 flex items-center justify-between">
              <span className="text-xs font-semibold tracking-wide text-zinc-200">OPC-478</span>
              <div className="flex items-center gap-1.5 font-mono text-[11px]">
                <span
                  className={`h-2 w-2 rounded-full ${
                    link ? "bg-emerald-400 shadow-[0_0_6px_#34d399]" : "bg-zinc-600"
                  }`}
                />
                <span className={link ? "text-emerald-400" : "text-zinc-400"}>
                  {link ? "online" : "offline"}
                </span>
              </div>
            </div>

            <div className="mb-3 flex items-center justify-between text-[11px] text-zinc-400">
              <span>Baud</span>
              <span className="font-mono tabular-nums text-zinc-300">9600 · 8N1</span>
            </div>

            <div className="grid grid-cols-2 gap-1.5">
              <button
                type="button"
                onClick={connect}
                disabled={!serialOk || !!busy}
                className={`flex items-center justify-center gap-1.5 rounded border px-2 py-1.5 text-xs font-medium whitespace-nowrap transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 disabled:opacity-40 ${
                  link
                    ? "border-red-800/70 bg-red-950/40 text-red-300 hover:bg-red-900/50"
                    : "border-blue-600/60 bg-blue-600/20 text-blue-300 hover:bg-blue-600/30"
                }`}
              >
                {link ? <Unplug className="h-3.5 w-3.5" /> : <Plug className="h-3.5 w-3.5" />}
                <span>{link ? "Disconnect" : "Connect"}</span>
              </button>

              <button
                type="button"
                onClick={() => setActiveTab("clone")}
                className="flex items-center justify-center gap-1 rounded border border-zinc-700 bg-zinc-800/70 px-2 py-1.5 text-xs font-medium text-zinc-200 whitespace-nowrap transition-colors hover:bg-zinc-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
              >
                <span>Clone</span>
                <ChevronRight className="h-3.5 w-3.5 text-zinc-400" />
              </button>
            </div>

            {/* SNELLE DOWNLOAD / UPLOAD KNOPPEN IN SIDEBAR */}
            <div className="mt-2 grid grid-cols-2 gap-1.5">
              <button
                type="button"
                onClick={requestDownload}
                disabled={!link || !!busy}
                title="Download kanalen van de IC-R10"
                className="flex items-center justify-center gap-1 rounded border border-zinc-800 bg-[#1e222a] px-2 py-1.5 text-[11px] font-medium text-zinc-300 whitespace-nowrap transition-colors hover:bg-zinc-700 disabled:opacity-35"
              >
                <Download className="h-3 w-3" />
                <span>Read Radio</span>
              </button>

              <button
                type="button"
                onClick={requestUpload}
                disabled={!link || !image || !!busy}
                title={
                  !image
                    ? "Lees eerst de scanner uit (Read Radio) voordat je kunt schrijven"
                    : "Schrijf kanalen naar de IC-R10"
                }
                className="flex items-center justify-center gap-1 rounded border border-zinc-800 bg-[#1e222a] px-2 py-1.5 text-[11px] font-medium text-zinc-300 whitespace-nowrap transition-colors hover:bg-zinc-700 disabled:opacity-35"
              >
                <Upload className="h-3 w-3" />
                <span>Write Radio</span>
              </button>
            </div>

            {busy && abortRef.current && (
              <button
                type="button"
                onClick={() => abortRef.current?.abort()}
                className="mt-2 flex w-full items-center justify-center gap-1.5 rounded border border-amber-700/60 bg-amber-950/50 py-1.5 text-xs font-medium text-amber-300 hover:bg-amber-900/50"
              >
                <Square className="h-3 w-3 fill-current" />
                <span>Cancel transfer</span>
              </button>
            )}
          </div>

          {/* MEMORY BANKS LIST (20 BANKS A-T) */}
          <div className="flex items-center justify-between px-3.5 pt-3 pb-1.5 text-[11px] text-zinc-400">
            <span className="font-semibold text-zinc-300">Memory Banks</span>
            <span className="font-mono tabular-nums text-zinc-500">50/bank</span>
          </div>

          <div className="flex-1 space-y-0.5 overflow-y-auto px-2 pb-3">
            {BANKS.map((letter, idx) => {
              const start = idx * CHANNELS_PER_BANK;
              const count = rows
                .slice(start, start + CHANNELS_PER_BANK)
                .filter((c) => c.freq.trim() !== "").length;
              const isSelected = selectedBank === idx && activeTab === "memories";
              return (
                <button
                  key={letter}
                  type="button"
                  onClick={() => {
                    selectBank(idx);
                    setActiveTab("memories");
                  }}
                  className={`flex w-full items-center justify-between rounded px-2.5 py-1.5 text-left text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${
                    isSelected
                      ? "border border-blue-500/40 bg-blue-600/15 font-medium text-white"
                      : "border border-transparent text-zinc-400 hover:bg-zinc-800/60 hover:text-zinc-200"
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <span
                      className={`flex h-4 w-4 items-center justify-center rounded font-mono text-[10px] ${
                        isSelected ? "bg-blue-500 text-white" : "bg-zinc-800 text-zinc-400"
                      }`}
                    >
                      {letter}
                    </span>
                    <span>Bank {letter}</span>
                  </div>
                  <span
                    className={`font-mono text-[11px] tabular-nums ${
                      count > 0 ? "text-zinc-300" : "text-zinc-600"
                    }`}
                  >
                    {count}
                  </span>
                </button>
              );
            })}
          </div>
        </aside>

        {/* RIGHT CONTENT AREA */}
        <main className="flex min-w-0 flex-1 flex-col overflow-hidden bg-[#111317]">
          {activeTab === "memories" && (
            <>
              {/* SUB-TOOLBAR */}
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-zinc-800/90 bg-[#15181e] px-4 py-2">
                <div className="flex flex-wrap items-center gap-2">
                  <div className="flex items-center gap-2 rounded border border-zinc-700/80 bg-[#1c2028] px-2.5 py-1 text-xs">
                    <span className="text-zinc-400">Bank</span>
                    <select
                      aria-label="Select memory bank"
                      value={selectedBank}
                      onChange={(e) => selectBank(Number(e.target.value))}
                      className="bg-transparent font-mono font-semibold text-zinc-100 focus:outline-none"
                    >
                      {BANKS.map((b, i) => (
                        <option key={b} value={i} className="bg-[#1c2028] text-zinc-100">
                          {b} ({i * 50}–{i * 50 + 49})
                        </option>
                      ))}
                    </select>
                  </div>

                  <button
                    type="button"
                    onClick={requestClearCurrentBank}
                    disabled={!!busy}
                    className="flex items-center gap-1.5 rounded border border-zinc-700 bg-zinc-800/60 px-2.5 py-1 text-xs text-zinc-300 whitespace-nowrap shrink-0 transition-colors hover:bg-zinc-700 disabled:opacity-40"
                  >
                    <Trash2 className="h-3.5 w-3.5 text-zinc-400" />
                    <span>Clear bank</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => upd(sel, blank(sel))}
                    disabled={!!busy}
                    className="flex items-center gap-1.5 rounded border border-zinc-700 bg-zinc-800/60 px-2.5 py-1 text-xs font-mono tabular-nums text-zinc-300 whitespace-nowrap shrink-0 transition-colors hover:bg-zinc-700 disabled:opacity-40"
                  >
                    <span>Clear ch {sel}</span>
                  </button>

                  <button
                    type="button"
                    onClick={requestLoadPresets}
                    disabled={!!busy}
                    title="Vul Bank A t/m F met 27MC, LPD/PMR, Beek/Maastricht, Eindhoven en Limburg Mil"
                    className="flex items-center gap-1.5 rounded border border-blue-700/50 bg-blue-950/40 px-2.5 py-1 text-xs text-blue-200 whitespace-nowrap shrink-0 transition-colors hover:bg-blue-900/50 disabled:opacity-40"
                  >
                    <ListPlus className="h-3.5 w-3.5" />
                    <span>Presets A–F</span>
                  </button>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <input
                    ref={fileRef}
                    type="file"
                    accept=".csv"
                    hidden
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) {
                        void importCsv(file);
                      }
                      e.target.value = "";
                    }}
                  />
                  <button
                    type="button"
                    onClick={() => fileRef.current?.click()}
                    disabled={!!busy}
                    className="flex items-center gap-1.5 rounded border border-zinc-700 bg-zinc-800/80 px-2.5 py-1 text-xs text-zinc-200 whitespace-nowrap shrink-0 transition-colors hover:bg-zinc-700 disabled:opacity-40"
                  >
                    <FileUp className="h-3.5 w-3.5" />
                    <span>Import CSV</span>
                  </button>

                  <button
                    type="button"
                    onClick={exportCsv}
                    className="flex items-center gap-1.5 rounded border border-zinc-700 bg-zinc-800/80 px-2.5 py-1 text-xs text-zinc-200 whitespace-nowrap shrink-0 transition-colors hover:bg-zinc-700"
                  >
                    <FileDown className="h-3.5 w-3.5" />
                    <span>Export CSV</span>
                  </button>

                  <button
                    type="button"
                    onClick={saveBackup}
                    disabled={!image || !!busy}
                    title="Sla de originele .bin image van de scanner op"
                    className="flex items-center gap-1.5 rounded border border-emerald-700/50 bg-emerald-950/40 px-2.5 py-1 text-xs text-emerald-300 whitespace-nowrap shrink-0 transition-colors hover:bg-emerald-900/50 disabled:opacity-35"
                  >
                    <Download className="h-3.5 w-3.5" />
                    <span>Backup .bin</span>
                  </button>
                </div>
              </div>

              {/* BANK HEADER & MODE FILTER TABS */}
              <div className="flex flex-col gap-3 border-b border-zinc-800/80 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <h1 className="text-base font-semibold text-white">
                    Bank {BANKS[selectedBank]} memories
                  </h1>
                  <p className="mt-0.5 font-mono text-xs tabular-nums text-zinc-400">
                    {filledInBank} programmed · 50 slots · CH {bankStart}–{bankEnd}
                  </p>
                </div>

                {/* FILTER BUTTONS (ALL, FM, WFM, AM, LSB, USB, CW, AUTO) */}
                <div className="flex flex-wrap items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => setModeFilter("ALL")}
                    className={`flex items-center gap-2 rounded border px-2.5 py-1 font-mono text-xs whitespace-nowrap transition-colors ${
                      modeFilter === "ALL"
                        ? "border-blue-500/60 bg-blue-600/20 text-white"
                        : "border-zinc-800 bg-[#1a1d24] text-zinc-400 hover:border-zinc-700 hover:text-zinc-200"
                    }`}
                  >
                    <span>All</span>
                    <span className="tabular-nums text-zinc-400">{filledInBank}</span>
                  </button>
                  {MODES.map((m) => (
                    <button
                      key={m}
                      type="button"
                      onClick={() => setModeFilter(m)}
                      className={`flex items-center gap-1.5 rounded border px-2.5 py-1 font-mono text-xs whitespace-nowrap transition-colors ${
                        modeFilter === m
                          ? "border-blue-500/60 bg-blue-600/20 text-white"
                          : "border-zinc-800 bg-[#1a1d24] text-zinc-400 hover:border-zinc-700 hover:text-zinc-200"
                      }`}
                    >
                      <span>{m}</span>
                      <span className="tabular-nums text-zinc-400">{modeCounts[m] ?? 0}</span>
                    </button>
                  ))}
                </div>
              </div>

              {/* CHANNEL GRID TABLE */}
              <div className="min-h-0 flex-1 overflow-auto">
                {visibleChannels.length === 0 ? (
                  <div className="flex h-full flex-col items-center justify-center gap-3 px-4 text-center">
                    <p className="text-sm text-zinc-400">
                      Geen {modeFilter} kanalen geprogrammeerd in Bank {BANKS[selectedBank]}.
                    </p>
                    <button
                      type="button"
                      onClick={() => setModeFilter("ALL")}
                      className="rounded border border-zinc-700 bg-zinc-800 px-3 py-1.5 text-xs font-medium text-zinc-200 hover:bg-zinc-700"
                    >
                      Toon alle 50 slots in Bank {BANKS[selectedBank]}
                    </button>
                  </div>
                ) : (
                  <table className="w-full border-collapse text-left text-xs">
                    <thead className="sticky top-0 z-10 border-b border-zinc-800 bg-[#16191f] text-[11px] font-medium text-zinc-400">
                      <tr>
                        <th className="w-24 px-3 py-2 font-mono">Loc</th>
                        <th className="w-40 px-3 py-2">Frequency (MHz)</th>
                        <th className="w-36 px-3 py-2">Name (8 ch)</th>
                        <th className="w-28 px-3 py-2">Mode</th>
                        <th className="w-16 px-3 py-2 text-center">Skip</th>
                        <th className="px-3 py-2">Comment (CSV only)</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-zinc-800/60">
                      {visibleChannels.map((c) => {
                        const isSelected = c.loc === sel;
                        const bankSlot = (c.loc % CHANNELS_PER_BANK).toString().padStart(2, "0");
                        const freqError = validateFreqInput(c.freq);
                        const hasFreq = c.freq.trim() !== "";
                        return (
                          <tr
                            key={c.loc}
                            onClick={() => setSel(c.loc)}
                            className={`transition-colors ${
                              isSelected
                                ? "bg-blue-950/25"
                                : "hover:bg-zinc-800/35"
                            }`}
                          >
                            <td className="px-3 py-1 font-mono tabular-nums text-zinc-400">
                              <span className={isSelected ? "font-semibold text-blue-300" : "text-zinc-300"}>
                                {c.loc.toString().padStart(3, "0")}
                              </span>
                              <span className="ml-2 text-[10px] text-zinc-600">
                                {BANKS[selectedBank]}
                                {bankSlot}
                              </span>
                            </td>

                            <td className="px-2 py-1">
                              <input
                                type="text"
                                inputMode="decimal"
                                value={c.freq}
                                disabled={!!busy}
                                placeholder="—"
                                title={freqError ?? "0.500000–1300.000000 MHz (10 Hz step)"}
                                onFocus={() => setSel(c.loc)}
                                onChange={(e) => upd(c.loc, { freq: e.target.value })}
                                onBlur={(e) => {
                                  const trimmed = e.target.value.trim();
                                  if (!trimmed) {
                                    if (c.freq !== "") upd(c.loc, { freq: "" });
                                    return;
                                  }
                                  if (!validateFreqInput(trimmed)) {
                                    const formatted = Number(trimmed).toFixed(6);
                                    if (formatted !== c.freq) {
                                      upd(c.loc, { freq: formatted });
                                    }
                                  }
                                }}
                                className={`w-full rounded border bg-[#16191f] px-2 py-1 font-mono text-xs tabular-nums text-zinc-100 placeholder-zinc-600 focus:outline-none ${
                                  freqError
                                    ? "border-red-500/80 text-red-300 focus:border-red-400"
                                    : "border-zinc-800 focus:border-blue-500"
                                }`}
                              />
                            </td>

                            <td className="px-2 py-1">
                              <input
                                type="text"
                                maxLength={8}
                                value={c.name}
                                disabled={!!busy}
                                placeholder={hasFreq ? "NAME" : ""}
                                onFocus={() => setSel(c.loc)}
                                onChange={(e) =>
                                  upd(c.loc, {
                                    name: e.target.value.replace(/[^\x20-\x7e]/g, "").slice(0, 8),
                                  })
                                }
                                className="w-full rounded border border-zinc-800 bg-[#16191f] px-2 py-1 font-mono text-xs text-zinc-100 placeholder-zinc-700 focus:border-blue-500 focus:outline-none"
                              />
                            </td>

                            <td className="px-2 py-1">
                              <select
                                aria-label={`Mode for channel ${c.loc}`}
                                value={c.mode}
                                disabled={!!busy}
                                onFocus={() => setSel(c.loc)}
                                onChange={(e) => upd(c.loc, { mode: e.target.value as Mode })}
                                className="w-full rounded border border-zinc-800 bg-[#16191f] px-2 py-1 font-mono text-xs text-zinc-200 focus:border-blue-500 focus:outline-none"
                              >
                                {MODES.map((m) => (
                                  <option key={m} value={m} className="bg-[#16191f] text-zinc-100">
                                    {m}
                                  </option>
                                ))}
                              </select>
                            </td>

                            <td className="px-3 py-1 text-center">
                              <input
                                type="checkbox"
                                aria-label={`Skip channel ${c.loc}`}
                                checked={c.skip}
                                disabled={!!busy || !hasFreq}
                                onFocus={() => setSel(c.loc)}
                                onChange={(e) => upd(c.loc, { skip: e.target.checked })}
                                className="h-3.5 w-3.5 cursor-pointer rounded border-zinc-700 bg-zinc-900 accent-blue-500 disabled:cursor-not-allowed disabled:opacity-35"
                              />
                            </td>

                            <td className="px-2 py-1">
                              <input
                                type="text"
                                value={c.comment}
                                disabled={!!busy}
                                placeholder=""
                                onFocus={() => setSel(c.loc)}
                                onChange={(e) => upd(c.loc, { comment: e.target.value })}
                                className="w-full rounded border border-zinc-800/80 bg-[#16191f] px-2 py-1 text-xs text-zinc-300 placeholder-zinc-700 focus:border-blue-500 focus:outline-none"
                              />
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                )}
              </div>
            </>
          )}

          {/* TAB 2: CLONE & OPC-478 INSTRUCTIES */}
          {activeTab === "clone" && (
            <div className="flex-1 overflow-y-auto p-6">
              <div className="mx-auto max-w-3xl space-y-6">
                <div>
                  <h1 className="text-lg font-semibold text-white">
                    OPC-478 Cloning & Range Settings
                  </h1>
                  <p className="mt-1 text-sm text-zinc-400">
                    Lees de volledige memory-image uit de Icom IC-R10 of schrijf het geselecteerde
                    kanaalbereik terug naar de scanner.
                  </p>
                </div>

                {/* RANGE SELECTOR */}
                <section className="rounded-lg border border-zinc-800 bg-[#16191f] p-5">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <h2 className="text-sm font-semibold text-zinc-100">
                      Actief Kanaalbereik voor Read / Write
                    </h2>
                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={() =>
                          setRange({
                            from: selectedBank * 50,
                            to: selectedBank * 50 + 49,
                          })
                        }
                        className="rounded border border-zinc-700 bg-zinc-800 px-2.5 py-1 text-[11px] font-medium text-zinc-300 hover:bg-zinc-700"
                      >
                        Alleen Bank {BANKS[selectedBank]}
                      </button>
                      <button
                        type="button"
                        onClick={() => setRange({ from: 0, to: 299 })}
                        className="rounded border border-zinc-700 bg-zinc-800 px-2.5 py-1 text-[11px] font-medium text-zinc-300 hover:bg-zinc-700"
                      >
                        Bank A–F (0–299)
                      </button>
                      <button
                        type="button"
                        onClick={() => setRange({ from: 0, to: 999 })}
                        className="rounded border border-zinc-700 bg-zinc-800 px-2.5 py-1 text-[11px] font-medium text-zinc-300 hover:bg-zinc-700"
                      >
                        Alle 1000 kanalen (0–999)
                      </button>
                    </div>
                  </div>

                  <div className="mt-4 grid grid-cols-2 gap-4 sm:max-w-sm">
                    <label className="block text-xs text-zinc-400">
                      <span className="mb-1 block">Van:</span>
                      <input
                        type="number"
                        min={0}
                        max={999}
                        value={range.from}
                        disabled={!!busy}
                        onChange={(e) =>
                          setRange((r) => ({
                            ...r,
                            from: Math.max(0, Math.min(999, Number(e.target.value) || 0)),
                          }))
                        }
                        className="w-full rounded border border-zinc-700 bg-[#111317] px-3 py-1.5 font-mono text-sm tabular-nums text-white focus:border-blue-500 focus:outline-none"
                      />
                    </label>
                    <label className="block text-xs text-zinc-400">
                      <span className="mb-1 block">Tot en met:</span>
                      <input
                        type="number"
                        min={0}
                        max={999}
                        value={range.to}
                        disabled={!!busy}
                        onChange={(e) =>
                          setRange((r) => ({
                            ...r,
                            to: Math.max(0, Math.min(999, Number(e.target.value) || 0)),
                          }))
                        }
                        className="w-full rounded border border-zinc-700 bg-[#111317] px-3 py-1.5 font-mono text-sm tabular-nums text-white focus:border-blue-500 focus:outline-none"
                      />
                    </label>
                  </div>

                  <div className="mt-5 flex flex-wrap items-center gap-3 border-t border-zinc-800 pt-4">
                    <button
                      type="button"
                      onClick={requestDownload}
                      disabled={!link || !!busy}
                      className="flex items-center gap-2 rounded bg-blue-600 px-3.5 py-2 text-xs font-medium text-white whitespace-nowrap hover:bg-blue-500 disabled:opacity-40"
                    >
                      <Download className="h-3.5 w-3.5" />
                      <span>1. Download from radio</span>
                    </button>

                    <button
                      type="button"
                      onClick={saveBackup}
                      disabled={!image || !!busy}
                      className="flex items-center gap-2 rounded border border-zinc-700 bg-zinc-800 px-3.5 py-2 text-xs font-medium text-zinc-200 whitespace-nowrap hover:bg-zinc-700 disabled:opacity-40"
                    >
                      <FileDown className="h-3.5 w-3.5" />
                      <span>2. Save .bin backup</span>
                    </button>

                    <button
                      type="button"
                      onClick={requestUpload}
                      disabled={!link || !image || !!busy}
                      className="flex items-center gap-2 rounded bg-emerald-600 px-3.5 py-2 text-xs font-medium text-white whitespace-nowrap hover:bg-emerald-500 disabled:opacity-40"
                    >
                      <Upload className="h-3.5 w-3.5" />
                      <span>3. Upload to radio</span>
                    </button>
                  </div>
                </section>

                {/* STAPPENPLAN */}
                <section className="rounded-lg border border-zinc-800 bg-[#16191f] p-5">
                  <h2 className="mb-4 text-sm font-semibold text-zinc-100">
                    OPC-478 Verbindingsinstructies (Icom IC-R10)
                  </h2>
                  <ol className="space-y-3 text-xs leading-relaxed text-zinc-300">
                    <li className="flex gap-3">
                      <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded bg-zinc-800 font-mono text-[11px] font-semibold text-zinc-300">
                        1
                      </span>
                      <span>
                        Gebruik Chrome of Edge op desktop. Steek de OPC-478 stekker in de{" "}
                        <strong className="font-semibold text-white">
                          [SP] (external speaker)
                        </strong>{" "}
                        aansluiting bovenop de IC-R10 — niet in de CI-V aansluiting aan de zijkant.
                      </span>
                    </li>
                    <li className="flex gap-3">
                      <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded bg-zinc-800 font-mono text-[11px] font-semibold text-zinc-300">
                        2
                      </span>
                      <span>
                        Zet de scanner uit. Houd <strong className="text-white">V/M</strong>{" "}
                        ingedrukt terwijl je <strong className="text-white">POWER</strong> 1 seconde
                        indrukt totdat <strong className="font-mono text-white">CLONE MODE</strong>{" "}
                        op het scherm verschijnt. Klik links op{" "}
                        <strong className="text-white">Connect</strong> en kies de juiste COM-poort.
                      </span>
                    </li>
                    <li className="flex gap-3">
                      <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded bg-zinc-800 font-mono text-[11px] font-semibold text-zinc-300">
                        3
                      </span>
                      <span>
                        <strong className="text-white">Uitlezen (Download):</strong> Klik op{" "}
                        <strong className="text-white">Download from radio</strong>, bevestig het
                        venster en druk daarna op <strong className="text-white">FUNC</strong> op
                        de scanner. Sla daarna eerst een <code className="font-mono">.bin</code>{" "}
                        backup op.
                      </span>
                    </li>
                    <li className="flex gap-3">
                      <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded bg-zinc-800 font-mono text-[11px] font-semibold text-zinc-300">
                        4
                      </span>
                      <span>
                        <strong className="text-white">Programmeren (Upload):</strong> Start de
                        scanner opnieuw op in <strong className="font-mono text-white">CLONE MODE</strong>,
                        klik op <strong className="text-white">Upload to radio</strong> en bevestig.{" "}
                        <strong className="text-amber-300">Druk NIET op FUNC.</strong> Laat kabel en
                        voeding aangesloten tot de scanner klaar is en herstart daarna de scanner.
                      </span>
                    </li>
                  </ol>
                </section>
              </div>
            </div>
          )}

          {/* TAB 3: SERIAL LOG */}
          {activeTab === "log" && (
            <div className="flex min-h-0 flex-1 flex-col p-6">
              <div className="mb-3 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Terminal className="h-4 w-4 text-zinc-400" />
                  <h1 className="text-sm font-semibold text-white">
                    OPC-478 Serial & Clone Log
                  </h1>
                </div>
                <button
                  type="button"
                  onClick={() => setLog([])}
                  className="rounded border border-zinc-700 bg-zinc-800 px-2.5 py-1 text-xs text-zinc-300 hover:bg-zinc-700"
                >
                  Clear log
                </button>
              </div>
              <pre className="min-h-0 flex-1 overflow-auto rounded-lg border border-zinc-800 bg-[#0d0f12] p-4 font-mono text-xs leading-relaxed text-zinc-300 select-text">
                {log.length ? log.join("\n") : "Nog geen seriële activiteit gelogd..."}
              </pre>
            </div>
          )}
        </main>
      </div>

      {/* BOTTOM STATUS BAR */}
      <footer className="flex h-8 shrink-0 items-center justify-between gap-4 border-t border-zinc-800/90 bg-[#16191f] px-4 text-[11px] text-zinc-400">
        <div className="flex min-w-0 items-center gap-2">
          <span
            className={`h-2 w-2 shrink-0 rounded-full ${
              link ? "bg-emerald-400" : "bg-zinc-600"
            }`}
          />
          <span className="truncate font-mono">{status}</span>
        </div>

        {busy && (
          <div className="flex items-center gap-2.5 shrink-0">
            <span className="font-mono tabular-nums text-blue-300">
              {busy.label} ({busy.done}/{busy.total})
            </span>
            <div className="h-1.5 w-28 overflow-hidden rounded-full bg-zinc-800">
              <div
                className="h-full bg-blue-500 transition-all duration-150"
                style={{
                  width: `${(busy.done / Math.max(1, busy.total)) * 100}%`,
                }}
              />
            </div>
          </div>
        )}

        <span className="hidden md:inline font-mono tabular-nums text-zinc-500 whitespace-nowrap shrink-0">
          Icom IC-R10 · 20 Banks × 50 Ch
        </span>
      </footer>

      {/* CONFIRMATION MODAL */}
      {confirmState && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="confirm-dialog-title"
        >
          <div className="w-full max-w-md rounded-lg border border-zinc-700 bg-[#181b22] p-5 shadow-2xl">
            <div className="flex items-start justify-between gap-3">
              <h2 id="confirm-dialog-title" className="text-sm font-semibold text-white">
                {confirmState.title}
              </h2>
              <button
                type="button"
                onClick={() => setConfirmState(null)}
                aria-label="Close confirmation"
                className="rounded p-1 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <p className="mt-3 whitespace-pre-line text-xs leading-relaxed text-zinc-300">
              {confirmState.message}
            </p>
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setConfirmState(null)}
                className="rounded border border-zinc-700 bg-zinc-800 px-3 py-1.5 text-xs font-medium text-zinc-300 hover:bg-zinc-700"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={confirmState.onConfirm}
                className={`rounded px-3.5 py-1.5 text-xs font-medium text-white ${
                  confirmState.tone === "danger"
                    ? "bg-red-600 hover:bg-red-500"
                    : confirmState.tone === "emerald"
                      ? "bg-emerald-600 hover:bg-emerald-500"
                      : "bg-blue-600 hover:bg-blue-500"
                }`}
              >
                {confirmState.confirmLabel}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
