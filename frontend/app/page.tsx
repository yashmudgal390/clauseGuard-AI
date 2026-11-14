"use client";

import React, { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import {
  Upload,
  FileText,
  CheckCircle,
  AlertCircle,
  ArrowRight,
  Sparkles,
  ShieldAlert,
  Loader2,
} from "lucide-react";
import { getHealth, getSampleContract, startThread } from "@/lib/api";
import type { HealthResponse } from "@/types/contract";

export default function LandingPage() {
  const router = useRouter();

  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [healthLoading, setHealthLoading] = useState(true);

  // Ingestion form state
  const [tab, setTab] = useState<"upload" | "paste">("upload");
  const [file, setFile] = useState<File | null>(null);
  const [pastedText, setPastedText] = useState("");
  const [contractTitle, setContractTitle] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [sampleLoading, setSampleLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);

  // Poll or check backend health on mount
  useEffect(() => {
    let isMounted = true;
    async function checkHealth() {
      try {
        const h = await getHealth();
        if (isMounted) setHealth(h);
      } catch (err) {
        console.warn("Backend health check failed:", err);
      } finally {
        if (isMounted) setHealthLoading(false);
      }
    }
    checkHealth();
    return () => {
      isMounted = false;
    };
  }, []);

  // Handle file select
  function handleFileSelect(selectedFile: File) {
    setErrorMessage(null);
    const validExtensions = [".pdf", ".txt", ".md"];
    const ext = selectedFile.name.substring(selectedFile.name.lastIndexOf(".")).toLowerCase();
    if (!validExtensions.includes(ext)) {
      setErrorMessage("Unsupported file format. Please upload a .pdf, .txt, or .md document.");
      return;
    }
    if (selectedFile.size > 10 * 1024 * 1024) {
      setErrorMessage("File exceeds 10 MB maximum upload limit.");
      return;
    }
    setFile(selectedFile);
    if (!contractTitle) {
      const cleanName = selectedFile.name.replace(/\.[^/.]+$/, "");
      setContractTitle(cleanName);
    }
  }

  // Handle submit (file or pasted text)
  async function handleSubmit(e?: React.FormEvent) {
    if (e) e.preventDefault();
    setErrorMessage(null);

    if (tab === "upload" && !file) {
      setErrorMessage("Please select a PDF or TXT contract to upload.");
      return;
    }
    if (tab === "paste" && !pastedText.trim()) {
      setErrorMessage("Please paste contract text into the input field.");
      return;
    }

    try {
      setIsSubmitting(true);
      const formData = new FormData();
      if (tab === "upload" && file) {
        formData.append("file", file);
      } else {
        formData.append("raw_text", pastedText.trim());
      }
      formData.append("contract_title", contractTitle.trim() || "Commercial Contract");

      const response = await startThread(formData);
      router.push(`/review/${response.thread_id}`);
    } catch (err: any) {
      setErrorMessage(err.message || "Failed to start contract redline thread.");
      setIsSubmitting(false);
    }
  }

  // 1-Click Recruiter Demo: Load sample MSA and start immediately
  async function handleRunSample() {
    try {
      setSampleLoading(true);
      setErrorMessage(null);
      const sample = await getSampleContract();
      const formData = new FormData();
      formData.append("raw_text", sample.raw_text);
      formData.append("contract_title", sample.title || "ApexCloud Enterprise MSA (Sample)");

      const res = await startThread(formData);
      router.push(`/review/${res.thread_id}`);
    } catch (err: any) {
      setErrorMessage(err.message || "Failed to launch sample contract demo.");
      setSampleLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-white text-[#0a0a0a] flex flex-col font-sans selection:bg-[#0a0a0a] selection:text-white">
      {/* Top Header Bar */}
      <header className="border-b border-[#e5e5e5] px-6 py-3.5 flex items-center justify-between sticky top-0 bg-white/90 backdrop-blur-sm z-30">
        <div className="flex items-center gap-3">
          <span className="font-mono text-sm tracking-wider font-bold">
            CLAUSEGUARD // AI
          </span>
          <span className="hidden sm:inline-block font-mono text-[10px] text-[#737373] border border-[#e5e5e5] px-2 py-0.5 rounded">
            v2.0 AUTONOMOUS
          </span>
        </div>

        <div className="flex items-center gap-3">
          {/* Health status pill */}
          <div className="flex items-center gap-1.5 font-mono text-xs text-[#525252] border border-[#e5e5e5] bg-[#fafafa] px-2.5 py-1 rounded">
            {healthLoading ? (
              <Loader2 className="w-3 h-3 animate-spin text-[#737373]" />
            ) : health?.status === "ok" ? (
              <>
                <span className="w-1.5 h-1.5 rounded-full bg-[#16a34a] animate-pulse" />
                <span className="text-[11px]">
                  Groq ({health.model || "Active"})
                </span>
              </>
            ) : (
              <>
                <span className="w-1.5 h-1.5 rounded-full bg-[#eab308]" />
                <span className="text-[11px]">Backend Offline</span>
              </>
            )}
          </div>

          <button
            onClick={handleRunSample}
            disabled={sampleLoading || isSubmitting}
            className="flex items-center gap-1.5 font-mono text-xs font-semibold bg-[#fafafa] hover:bg-[#0a0a0a] hover:text-white text-[#0a0a0a] border border-[#e5e5e5] hover:border-[#0a0a0a] px-3 py-1.5 rounded transition-all disabled:opacity-50"
          >
            {sampleLoading ? (
              <Loader2 className="w-3 h-3 animate-spin" />
            ) : (
              <Sparkles className="w-3 h-3" />
            )}
            <span>Load Sample SaaS MSA</span>
          </button>
        </div>
      </header>

      {/* Main Hero & Ingestion Zone */}
      <main className="flex-1 flex flex-col items-center justify-center px-4 py-12">
        <div className="w-full max-w-[760px] space-y-8">
          {/* Headline & Subtitle */}
          <div className="text-center space-y-3">
            <div className="inline-flex items-center gap-1.5 font-mono text-xs text-[#737373] bg-[#fafafa] border border-[#e5e5e5] px-3 py-1 rounded-full mb-1">
              <span>LangGraph Cyclic StateGraph</span>
              <span className="text-[#a3a3a3]">/</span>
              <span>pgvector Small-to-Big RAG</span>
            </div>
            <h1 className="text-3xl sm:text-4xl font-extrabold tracking-tight text-[#0a0a0a]">
              Autonomous Contract Redlining &amp; Compliance Verification
            </h1>
            <p className="text-sm sm:text-base text-[#525252] max-w-2xl mx-auto leading-relaxed">
              Upload commercial contracts for automated clause extraction, Auto-Merging Playbook RAG matching, cyclic self-critique audits, and instant Word (.docx) export with durable Human-in-the-Loop review.
            </p>
          </div>

          {/* Quick Recruiter Demo Action Banner */}
          <div className="bg-[#fafafa] border border-[#e5e5e5] rounded-lg p-4 flex flex-col sm:flex-row items-center justify-between gap-3 shadow-xs">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded bg-[#0a0a0a] text-white flex items-center justify-center shrink-0">
                <FileText className="w-4 h-4" />
              </div>
              <div className="text-left">
                <div className="text-xs font-bold text-[#0a0a0a]">
                  One-Click Recruiter Demo
                </div>
                <div className="text-[11px] text-[#737373]">
                  Loads pre-built SaaS MSA with hidden $100 liability caps, AI training rights, &amp; 120-day lock-ins.
                </div>
              </div>
            </div>
            <button
              onClick={handleRunSample}
              disabled={sampleLoading || isSubmitting}
              className="w-full sm:w-auto font-mono text-xs font-semibold bg-[#0a0a0a] text-white px-4 py-2 rounded hover:bg-[#262626] transition-all flex items-center justify-center gap-1.5 shrink-0 disabled:opacity-50"
            >
              {sampleLoading ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  <span>Launching Pipeline...</span>
                </>
              ) : (
                <>
                  <span>Run Sample SaaS Agreement</span>
                  <ArrowRight className="w-3.5 h-3.5" />
                </>
              )}
            </button>
          </div>

          {/* Error Banner */}
          {errorMessage && (
            <div className="bg-[#fef2f2] border border-[#fecaca] rounded-lg p-3.5 flex items-start gap-2.5 text-xs text-[#991b1b]">
              <ShieldAlert className="w-4 h-4 shrink-0 mt-0.5" />
              <div className="flex-1">{errorMessage}</div>
            </div>
          )}

          {/* Ingestion Card */}
          <div className="bg-white border border-[#e5e5e5] rounded-xl overflow-hidden shadow-xs">
            {/* Mode Tabs */}
            <div className="flex border-b border-[#e5e5e5] bg-[#fafafa]">
              <button
                type="button"
                onClick={() => setTab("upload")}
                className={`flex-1 py-3 text-xs font-mono font-semibold transition-colors flex items-center justify-center gap-2 border-b-2 ${
                  tab === "upload"
                    ? "border-[#0a0a0a] text-[#0a0a0a] bg-white"
                    : "border-transparent text-[#737373] hover:text-[#0a0a0a]"
                }`}
              >
                <Upload className="w-3.5 h-3.5" />
                <span>Upload PDF / TXT Document</span>
              </button>
              <button
                type="button"
                onClick={() => setTab("paste")}
                className={`flex-1 py-3 text-xs font-mono font-semibold transition-colors flex items-center justify-center gap-2 border-b-2 ${
                  tab === "paste"
                    ? "border-[#0a0a0a] text-[#0a0a0a] bg-white"
                    : "border-transparent text-[#737373] hover:text-[#0a0a0a]"
                }`}
              >
                <FileText className="w-3.5 h-3.5" />
                <span>Paste Contract Text</span>
              </button>
            </div>

            {/* Tab Body */}
            <form onSubmit={handleSubmit} className="p-6 space-y-5">
              {/* Contract Title Input */}
              <div>
                <label className="block font-mono text-[11px] uppercase tracking-wider text-[#737373] mb-1.5">
                  Contract Title / Reference
                </label>
                <input
                  type="text"
                  placeholder="e.g., Master Services Agreement (Vendor Corp)"
                  value={contractTitle}
                  onChange={(e) => setContractTitle(e.target.value)}
                  className="w-full text-sm font-sans px-3.5 py-2.5 rounded border border-[#e5e5e5] focus:outline-none focus:border-[#0a0a0a] transition-colors"
                />
              </div>

              {tab === "upload" ? (
                /* Drag and drop zone */
                <div>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".pdf,.txt,.md"
                    className="hidden"
                    onChange={(e) => {
                      if (e.target.files && e.target.files[0]) {
                        handleFileSelect(e.target.files[0]);
                      }
                    }}
                  />
                  <div
                    onDragOver={(e) => {
                      e.preventDefault();
                      setIsDragging(true);
                    }}
                    onDragLeave={() => setIsDragging(false)}
                    onDrop={(e) => {
                      e.preventDefault();
                      setIsDragging(false);
                      if (e.dataTransfer.files && e.dataTransfer.files[0]) {
                        handleFileSelect(e.dataTransfer.files[0]);
                      }
                    }}
                    onClick={() => fileInputRef.current?.click()}
                    className={`border-2 border-dashed rounded-lg p-8 text-center cursor-pointer transition-all ${
                      isDragging
                        ? "border-[#0a0a0a] bg-[#fafafa]"
                        : file
                        ? "border-[#166534] bg-[#f0fdf4]"
                        : "border-[#e5e5e5] hover:border-[#a3a3a3] bg-white"
                    }`}
                  >
                    {file ? (
                      <div className="flex flex-col items-center gap-2">
                        <CheckCircle className="w-8 h-8 text-[#166534]" />
                        <span className="font-mono text-xs font-bold text-[#166534]">
                          {file.name}
                        </span>
                        <span className="font-mono text-[10px] text-[#737373]">
                          {(file.size / 1024).toFixed(1)} KB — Click or drop another to replace
                        </span>
                      </div>
                    ) : (
                      <div className="flex flex-col items-center gap-2 text-[#737373]">
                        <Upload className="w-8 h-8 text-[#a3a3a3]" />
                        <div className="text-xs font-semibold text-[#0a0a0a]">
                          Click to browse or drag and drop contract file
                        </div>
                        <div className="font-mono text-[10.5px]">
                          Supports .PDF (digital/text), .TXT, .MD (up to 10 MB)
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              ) : (
                /* Paste Text Area */
                <div>
                  <label className="block font-mono text-[11px] uppercase tracking-wider text-[#737373] mb-1.5">
                    Contract Text
                  </label>
                  <textarea
                    rows={8}
                    value={pastedText}
                    onChange={(e) => setPastedText(e.target.value)}
                    placeholder="Paste full agreement terms, clauses, or sections here..."
                    className="w-full font-mono text-xs leading-relaxed p-3.5 rounded border border-[#e5e5e5] focus:outline-none focus:border-[#0a0a0a] transition-colors resize-y"
                  />
                  <div className="flex justify-between items-center text-[10.5px] font-mono text-[#737373] mt-1">
                    <span>Token limit guardrail: ~32,000 tokens safe window</span>
                    <span>{pastedText.length} characters</span>
                  </div>
                </div>
              )}

              {/* Start Ingestion Button */}
              <button
                type="submit"
                disabled={isSubmitting || (tab === "upload" && !file) || (tab === "paste" && !pastedText.trim())}
                className="w-full py-3 bg-[#0a0a0a] hover:bg-[#262626] text-white font-mono text-xs font-bold tracking-wider rounded transition-all flex items-center justify-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {isSubmitting ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>PARSING CONTRACT &amp; INITIALIZING GRAPH...</span>
                  </>
                ) : (
                  <>
                    <span>START AUTONOMOUS REDLINE PIPELINE</span>
                    <ArrowRight className="w-4 h-4" />
                  </>
                )}
              </button>
            </form>
          </div>

          {/* Technical Architecture Footnote */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-2 text-center text-xs text-[#737373]">
            <div className="border border-[#e5e5e5] bg-[#fafafa] rounded p-3">
              <span className="font-mono font-bold text-[#0a0a0a] block text-[11px] mb-0.5">
                SMALL-TO-BIG RAG
              </span>
              Parent ~1200 char sections stored in Supabase with pgvector leaf chunks.
            </div>
            <div className="border border-[#e5e5e5] bg-[#fafafa] rounded p-3">
              <span className="font-mono font-bold text-[#0a0a0a] block text-[11px] mb-0.5">
                CYCLIC CRITIQUE LOOP
              </span>
              Iterative legal critic loop evaluates and refines redlines automatically.
            </div>
            <div className="border border-[#e5e5e5] bg-[#fafafa] rounded p-3">
              <span className="font-mono font-bold text-[#0a0a0a] block text-[11px] mb-0.5">
                DURABLE HITL RESUME
              </span>
              Postgres checkpointer preserves interrupt state across browser refreshes.
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
