"use client";

import { useMemo, useState } from "react";

type DocItem = {
  name: string;
  markdown: string;
  html: string;
};

type WarningItem = {
  code: string;
  message: string;
  suggestion?: string;
};

type ApiSuccess = {
  warnings: WarningItem[];
  documents: DocItem[];
  bundleBase64: string;
};

const phases = [
  "Upload zip",
  "Validazione struttura iFlow",
  "Parsing deterministico",
  "Generazione documenti",
  "Packaging output",
];

const decodeBase64ToBlob = (base64: string, mimeType: string) => {
  const raw = atob(base64);
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) {
    bytes[i] = raw.charCodeAt(i);
  }
  return new Blob([bytes], { type: mimeType });
};

const downloadText = (fileName: string, content: string, type: string) => {
  const blob = new Blob([content], { type });
  const href = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = href;
  a.download = fileName;
  a.click();
  URL.revokeObjectURL(href);
};

export default function Home() {
  const [file, setFile] = useState<File | null>(null);
  const [phaseIndex, setPhaseIndex] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<WarningItem[]>([]);
  const [documents, setDocuments] = useState<DocItem[]>([]);
  const [bundleBase64, setBundleBase64] = useState<string>("");
  const [activeDoc, setActiveDoc] = useState(0);
  const [previewMode, setPreviewMode] = useState<"markdown" | "html">("markdown");

  const canGenerate = Boolean(file) && !loading;
  const activeDocument = documents[activeDoc];

  const statusLabel = useMemo(() => {
    if (!loading && documents.length > 0) {
      return "Completato";
    }
    return phases[Math.min(phaseIndex, phases.length - 1)];
  }, [loading, phaseIndex, documents.length]);

  const handleSubmit = async () => {
    if (!file) {
      return;
    }

    setLoading(true);
    setError(null);
    setWarnings([]);
    setDocuments([]);
    setBundleBase64("");
    setPhaseIndex(0);

    try {
      const formData = new FormData();
      formData.append("file", file);

      setPhaseIndex(1);
      const response = await fetch("/api/generate", {
        method: "POST",
        body: formData,
      });

      setPhaseIndex(3);
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(
          payload?.error?.message ||
            "Errore nella generazione. Suggerimento: verifica zip e struttura iFlow.",
        );
      }

      const success = payload as ApiSuccess;
      setWarnings(success.warnings);
      setDocuments(success.documents);
      setBundleBase64(success.bundleBase64);
      setActiveDoc(0);
      setPhaseIndex(4);
    } catch (e) {
      const message = e instanceof Error ? e.message : "Errore sconosciuto";
      setError(message);
    } finally {
      setLoading(false);
    }
  };

  const onDrop: React.DragEventHandler<HTMLDivElement> = (event) => {
    event.preventDefault();
    const dropped = event.dataTransfer.files?.[0];
    if (dropped) {
      setFile(dropped);
      setError(null);
    }
  };

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-6 px-4 py-6 md:px-8 md:py-10">
      <section className="panel p-6 md:p-8">
        <p className="mono text-xs uppercase tracking-[0.18em] text-cyan-700">
          SAP CPI Doc Forge
        </p>
        <h1 className="mt-2 text-3xl font-bold md:text-4xl">iFlow ZIP to Documentation</h1>
        <p className="mt-3 max-w-3xl text-sm text-slate-600 md:text-base">
          Carica un export ZIP di SAP Integration Flow e genera in modo deterministico Documento Tecnico,
          Funzionale, Handover, versioni Markdown/HTML e pacchetto finale ZIP.
        </p>
      </section>

      <section className="grid gap-6 md:grid-cols-2">
        <div className="panel p-5">
          <div
            className="rounded-xl border border-dashed border-cyan-400 bg-cyan-50/40 p-6 text-center"
            onDragOver={(e) => e.preventDefault()}
            onDrop={onDrop}
          >
            <p className="text-sm text-slate-700">Drag & drop ZIP iFlow</p>
            <p className="mt-2 text-xs text-slate-500">oppure seleziona manualmente</p>
            <input
              type="file"
              accept=".zip"
              className="mt-4 block w-full rounded border border-slate-300 bg-white px-3 py-2 text-sm"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            />
            <p className="mono mt-3 text-xs text-slate-600">{file ? file.name : "Nessun file selezionato"}</p>
          </div>

          <button
            type="button"
            className="mt-4 w-full rounded-lg bg-teal-700 px-4 py-3 text-sm font-semibold text-white transition hover:bg-teal-600 disabled:cursor-not-allowed disabled:bg-slate-400"
            disabled={!canGenerate}
            onClick={handleSubmit}
          >
            {loading ? "Generazione in corso..." : "Genera documentazione"}
          </button>
        </div>

        <div className="panel p-5">
          <h2 className="text-lg font-semibold">Progress status</h2>
          <p className="mt-2 text-sm text-slate-600">Fase corrente: {statusLabel}</p>
          <ul className="mt-4 space-y-2">
            {phases.map((phase, idx) => (
              <li
                key={phase}
                className={`rounded-md px-3 py-2 text-sm ${
                  idx < phaseIndex
                    ? "bg-teal-50 text-teal-800"
                    : idx === phaseIndex && loading
                      ? "bg-cyan-50 text-cyan-700"
                      : "bg-slate-50 text-slate-600"
                }`}
              >
                {idx + 1}. {phase}
              </li>
            ))}
          </ul>
        </div>
      </section>

      {(error || warnings.length > 0) && (
        <section className="panel p-5">
          <h2 className="text-lg font-semibold">Warning / Errori</h2>
          {error && (
            <div className="mt-3 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
              <p className="font-semibold">Errore</p>
              <p>{error}</p>
              <p className="mt-1 text-xs">Azione suggerita: verifica file critici e riprova.</p>
            </div>
          )}
          {warnings.length > 0 && (
            <ul className="mt-3 space-y-2">
              {warnings.map((w) => (
                <li key={w.code + w.message} className="rounded-lg border border-amber-200 bg-amber-50 p-3">
                  <p className="mono text-xs text-amber-800">{w.code}</p>
                  <p className="text-sm text-amber-900">{w.message}</p>
                  {w.suggestion && <p className="mt-1 text-xs text-amber-800">{w.suggestion}</p>}
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {documents.length > 0 && (
        <section className="panel p-5">
          <div className="flex flex-wrap items-center gap-2">
            {documents.map((doc, idx) => (
              <button
                key={doc.name}
                type="button"
                onClick={() => setActiveDoc(idx)}
                className={`rounded-full px-3 py-1 text-xs font-semibold ${
                  idx === activeDoc ? "bg-cyan-700 text-white" : "bg-slate-100 text-slate-700"
                }`}
              >
                {doc.name}
              </button>
            ))}
            <div className="ml-auto flex gap-2">
              <button
                type="button"
                className={`rounded-md px-3 py-1 text-xs ${
                  previewMode === "markdown" ? "bg-slate-800 text-white" : "bg-slate-100 text-slate-700"
                }`}
                onClick={() => setPreviewMode("markdown")}
              >
                Markdown
              </button>
              <button
                type="button"
                className={`rounded-md px-3 py-1 text-xs ${
                  previewMode === "html" ? "bg-slate-800 text-white" : "bg-slate-100 text-slate-700"
                }`}
                onClick={() => setPreviewMode("html")}
              >
                HTML
              </button>
            </div>
          </div>

          <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-4">
            {activeDocument && previewMode === "markdown" && (
              <article className="markdown-preview whitespace-pre-wrap text-sm text-slate-800">
                {activeDocument.markdown}
              </article>
            )}
            {activeDocument && previewMode === "html" && (
              <iframe
                title="html-preview"
                className="h-[420px] w-full rounded bg-white"
                srcDoc={activeDocument.html}
              />
            )}
          </div>

          <div className="mt-4 flex flex-wrap gap-2">
            {activeDocument && (
              <>
                <button
                  type="button"
                  className="rounded-md bg-cyan-700 px-3 py-2 text-xs font-semibold text-white"
                  onClick={() =>
                    downloadText(`${activeDocument.name}.md`, activeDocument.markdown, "text/markdown")
                  }
                >
                  Download Markdown
                </button>
                <button
                  type="button"
                  className="rounded-md bg-sky-700 px-3 py-2 text-xs font-semibold text-white"
                  onClick={() =>
                    downloadText(`${activeDocument.name}.html`, activeDocument.html, "text/html")
                  }
                >
                  Download HTML
                </button>
              </>
            )}
            {bundleBase64 && (
              <button
                type="button"
                className="rounded-md bg-teal-700 px-3 py-2 text-xs font-semibold text-white"
                onClick={() => {
                  const blob = decodeBase64ToBlob(bundleBase64, "application/zip");
                  const href = URL.createObjectURL(blob);
                  const a = document.createElement("a");
                  a.href = href;
                  a.download = "sap-iflow-documentation-output.zip";
                  a.click();
                  URL.revokeObjectURL(href);
                }}
              >
                Download All (.zip)
              </button>
            )}
          </div>
        </section>
      )}
    </main>
  );
}
