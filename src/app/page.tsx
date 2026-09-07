"use client";

import { useEffect, useState } from "react";
import { listLocalSessionMeta, saveLocalSessionMeta } from "@/lib/client/session-history";
import { getLocaleMessages, supportedLanguages } from "@/lib/locales";
import type {
  GeneratedDocument,
  GeneratedSessionMeta,
  LanguageCode,
  QualityGateReport,
  StructuredWarning,
} from "@/lib/types";

type ApiSuccess = {
  sessionId: string;
  sharePath: string;
  warnings: StructuredWarning[];
  documents: GeneratedDocument[];
  bundleBase64: string;
  locale: LanguageCode;
  qualityGate: QualityGateReport;
};

type SessionResponse = GeneratedSessionMeta & {
  warnings: StructuredWarning[];
  documents: GeneratedDocument[];
  qualityGate: QualityGateReport;
};

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
  const [files, setFiles] = useState<File[]>([]);
  const [language, setLanguage] = useState<LanguageCode>("it");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<StructuredWarning[]>([]);
  const [documents, setDocuments] = useState<GeneratedDocument[]>([]);
  const [bundleBase64, setBundleBase64] = useState("");
  const [activeDoc, setActiveDoc] = useState(0);
  const [previewMode, setPreviewMode] = useState<"markdown" | "html">("markdown");
  const [activeTab, setActiveTab] = useState<"upload" | "history">("upload");
  const [serverSessions, setServerSessions] = useState<GeneratedSessionMeta[]>([]);
  const [localSessions, setLocalSessions] = useState<GeneratedSessionMeta[]>([]);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [sharePath, setSharePath] = useState("");
  const [qualityGate, setQualityGate] = useState<QualityGateReport | null>(null);
  const locale = getLocaleMessages(language);

  const activeDocument = documents[activeDoc];

  const refreshSessions = async () => {
    try {
      const [serverResponse, local] = await Promise.all([
        fetch("/api/sessions").then((response) => response.json()),
        listLocalSessionMeta(),
      ]);
      setServerSessions(serverResponse.sessions ?? []);
      setLocalSessions(local);
    } catch {
      setLocalSessions([]);
    }
  };

  useEffect(() => {
    const storedLanguage = window.localStorage.getItem("doc-language") as LanguageCode | null;
    if (storedLanguage && supportedLanguages.includes(storedLanguage)) {
      setLanguage(storedLanguage);
    }
    refreshSessions();
  }, []);

  useEffect(() => {
    window.localStorage.setItem("doc-language", language);
  }, [language]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const sharedSession = params.get("session");
    if (!sharedSession) {
      return;
    }

    const loadSharedSession = async () => {
      try {
        const response = await fetch(`/api/sessions/${sharedSession}`);
        if (!response.ok) {
          return;
        }
        const payload = (await response.json()) as SessionResponse;
        setDocuments(payload.documents);
        setWarnings(payload.warnings);
        setQualityGate(payload.qualityGate);
        setLanguage(payload.language);
        setSessionId(payload.id);
        setSharePath(payload.sharePath);
        setActiveDoc(0);
      } catch {
        // Ignore shared-session restore failures in UI.
      }
    };

    loadSharedSession();
  }, []);

  const canGenerate = files.length > 0 && !loading;

  const handleSubmit = async () => {
    if (files.length === 0) {
      return;
    }

    setLoading(true);
    setError(null);
    setWarnings([]);
    setDocuments([]);
    setBundleBase64("");

    try {
      const formData = new FormData();
      files.forEach((file) => formData.append("files", file));
      formData.append("language", language);

      const response = await fetch("/api/generate", {
        method: "POST",
        body: formData,
      });

      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload?.error?.message || "Generation failed.");
      }

      const success = payload as ApiSuccess;
      setWarnings(success.warnings);
      setDocuments(success.documents);
      setBundleBase64(success.bundleBase64);
      setActiveDoc(0);
      setSessionId(success.sessionId);
      setSharePath(success.sharePath);
      setQualityGate(success.qualityGate);

      await saveLocalSessionMeta({
        id: success.sessionId,
        createdAt: new Date().toISOString(),
        fileName: files.map((file) => file.name).join(", "),
        language,
        mode: "deterministic",
        templateIds: ["technical"],
        aiUsed: false,
        sharePath: success.sharePath,
      });
      await refreshSessions();
      setActiveTab("upload");
    } catch (submissionError) {
      setError(submissionError instanceof Error ? submissionError.message : "Errore sconosciuto");
    } finally {
      setLoading(false);
    }
  };

  const onDrop: React.DragEventHandler<HTMLDivElement> = (event) => {
    event.preventDefault();
    const dropped = Array.from(event.dataTransfer.files ?? []).filter((file) =>
      file.name.toLowerCase().endsWith(".zip"),
    );
    if (dropped.length > 0) {
      setFiles(dropped);
      setError(null);
    }
  };

  const copyShareLink = async () => {
    if (!sharePath) {
      return;
    }
    await navigator.clipboard.writeText(`${window.location.origin}${sharePath}`);
  };

  return (
    <main className="mx-auto flex w-full max-w-7xl flex-1 flex-col gap-6 px-4 py-6 md:px-8 md:py-10">
      <section className="panel p-6 md:p-8">
        <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
          <div>
            <p className="mono text-xs uppercase tracking-[0.18em] text-cyan-700">{locale.ui.appName}</p>
            <h1 className="mt-2 text-3xl font-bold md:text-4xl">{locale.ui.headline}</h1>
            <p className="mt-3 max-w-4xl text-sm text-slate-600 md:text-base">{locale.ui.subtitle}</p>
          </div>

          <div className="grid gap-3 rounded-2xl border border-slate-200 bg-slate-50 p-4 md:min-w-[320px]">
            <label className="text-sm font-medium text-slate-700">
              {locale.ui.labels.language}
              <select
                className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
                value={language}
                onChange={(event) => setLanguage(event.target.value as LanguageCode)}
              >
                {supportedLanguages.map((lang) => (
                  <option key={lang} value={lang}>
                    {locale.ui.languages[lang]}
                  </option>
                ))}
              </select>
            </label>

          </div>
        </div>

        <div className="mt-5 flex flex-wrap gap-2">
          {(["upload", "history"] as const).map((tab) => (
            <button
              key={tab}
              type="button"
              onClick={() => setActiveTab(tab)}
              className={`rounded-full px-4 py-2 text-sm font-semibold ${
                activeTab === tab ? "bg-cyan-700 text-white" : "bg-slate-100 text-slate-700"
              }`}
            >
              {locale.ui.tabs[tab]}
            </button>
          ))}
        </div>
      </section>

      {activeTab === "upload" && (
        <section>
          <div className="panel p-5">
            <div
              className="rounded-xl border border-dashed border-cyan-400 bg-cyan-50/40 p-6 text-center"
              onDragOver={(event) => event.preventDefault()}
              onDrop={onDrop}
            >
              <p className="text-sm text-slate-700">{locale.ui.labels.uploadHint}</p>
              <input
                type="file"
                accept=".zip"
                multiple
                className="mt-4 block w-full rounded border border-slate-300 bg-white px-3 py-2 text-sm"
                onChange={(event) => {
                  setFiles(Array.from(event.target.files ?? []));
                  setError(null);
                }}
              />
              <div className="mono mt-3 text-left text-xs text-slate-600">
                {files.length > 0 ? (
                  <ul className="space-y-1">
                    {files.map((file) => <li key={`${file.name}-${file.lastModified}`}>{file.name}</li>)}
                  </ul>
                ) : (
                  locale.ui.labels.noFile
                )}
              </div>
            </div>

            <button
              type="button"
              className="mt-4 w-full rounded-lg bg-teal-700 px-4 py-3 text-sm font-semibold text-white transition hover:bg-teal-600 disabled:cursor-not-allowed disabled:bg-slate-400"
              disabled={!canGenerate}
              onClick={handleSubmit}
            >
              {loading ? locale.ui.labels.generating : locale.ui.labels.generate}
            </button>
          </div>

        </section>
      )}

      {activeTab === "history" && (
        <section className="grid gap-6 md:grid-cols-2">
          <div className="panel p-5">
            <h2 className="text-lg font-semibold">Server sessions</h2>
            <div className="mt-4 space-y-3">
              {serverSessions.length === 0 && <p className="text-sm text-slate-500">No recent sessions.</p>}
              {serverSessions.map((session) => (
                <button
                  key={session.id}
                  type="button"
                  className="block w-full rounded-xl border border-slate-200 bg-slate-50 p-3 text-left"
                  onClick={() => {
                    window.location.href = session.sharePath;
                  }}
                >
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-sm font-semibold text-slate-900">{session.fileName}</span>
                    <span className="mono text-xs text-slate-500">{session.language.toUpperCase()}</span>
                  </div>
                  <p className="mt-1 text-xs text-slate-500">{new Date(session.createdAt).toLocaleString()}</p>
                </button>
              ))}
            </div>
          </div>

          <div className="panel p-5">
            <h2 className="text-lg font-semibold">Local history</h2>
            <div className="mt-4 space-y-3">
              {localSessions.length === 0 && <p className="text-sm text-slate-500">No recent sessions.</p>}
              {localSessions.map((session) => (
                <div key={session.id} className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-sm font-semibold text-slate-900">{session.fileName}</span>
                    <span className="mono text-xs text-slate-500">{session.mode}</span>
                  </div>
                  <p className="mt-1 text-xs text-slate-500">{new Date(session.createdAt).toLocaleString()}</p>
                </div>
              ))}
            </div>
          </div>
        </section>
      )}

      {(error || warnings.length > 0 || qualityGate) && (
        <section className="panel p-5">
          <h2 className="text-lg font-semibold">Warnings / Errors</h2>
          {error && <div className="mt-3 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>}
          {qualityGate && (
            <div className="mt-3 rounded-lg border border-cyan-200 bg-cyan-50 p-3 text-sm text-cyan-900">
              Quality gate: {(qualityGate.score * 100).toFixed(0)}%
            </div>
          )}
          {warnings.length > 0 && (
            <ul className="mt-3 space-y-2">
              {warnings.map((warning) => (
                <li key={`${warning.code}-${warning.message}`} className="rounded-lg border border-amber-200 bg-amber-50 p-3">
                  <p className="mono text-xs text-amber-800">{warning.code}</p>
                  <p className="text-sm text-amber-900">{warning.message}</p>
                  {warning.suggestion && <p className="mt-1 text-xs text-amber-800">{warning.suggestion}</p>}
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
                {doc.displayName ?? doc.name}
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
              <article className="markdown-preview whitespace-pre-wrap text-sm text-slate-800">{activeDocument.markdown}</article>
            )}
            {activeDocument && previewMode === "html" && (
              <iframe title="html-preview" className="h-[520px] w-full rounded bg-white" srcDoc={activeDocument.html} />
            )}
          </div>

          <div className="mt-4 flex flex-wrap gap-2">
            {activeDocument && (
              <>
                <button
                  type="button"
                  className="rounded-md bg-cyan-700 px-3 py-2 text-xs font-semibold text-white"
                  onClick={() => downloadText(`${activeDocument.name}.md`, activeDocument.markdown, "text/markdown")}
                >
                  Download Markdown
                </button>
                <button
                  type="button"
                  className="rounded-md bg-sky-700 px-3 py-2 text-xs font-semibold text-white"
                  onClick={() => downloadText(`${activeDocument.name}.html`, activeDocument.html, "text/html")}
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
            {sharePath && (
              <button
                type="button"
                className="rounded-md bg-slate-800 px-3 py-2 text-xs font-semibold text-white"
                onClick={copyShareLink}
              >
                Copy public link
              </button>
            )}
          </div>

          {sessionId && <p className="mono mt-3 text-xs text-slate-500">session: {sessionId}</p>}
        </section>
      )}
    </main>
  );
}
