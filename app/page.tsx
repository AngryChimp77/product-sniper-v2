"use client";

import { useState } from "react";

type AnalysisResult = {
  score: number;
  verdict: string;
  reason: string;
};

export default function Home() {
  const [link, setLink] = useState("");
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function analyze() {
    if (!link.trim()) {
      setError("Please paste a product link to analyze.");
      setResult(null);
      return;
    }

    try {
      setIsLoading(true);
      setError(null);

      const response = await fetch("/api/analyze", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ link }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => null);
        throw new Error(errorData?.error || "Failed to analyze product");
      }

      const data = await response.json();
      setResult(data);
    } catch (err) {
      console.error(err);
      setResult({
        score: 0,
        verdict: "ERROR",
        reason: "Could not analyze this link. Please try again.",
      });
      setError("Something went wrong while analyzing this product.");
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <main className="min-h-screen bg-slate-950 text-slate-100 flex items-center justify-center px-4">
      <div className="w-full max-w-xl space-y-8">
        <div className="text-center space-y-3">
          <h1 className="text-3xl sm:text-4xl font-semibold tracking-tight">
            🚀 Product Sniper
          </h1>
          <p className="text-sm text-slate-400">
            Paste any product URL to instantly score its potential and get a clear
            verdict.
          </p>
        </div>

        <div className="bg-slate-900/60 border border-slate-800/80 rounded-2xl p-5 sm:p-6 shadow-xl shadow-slate-950/40 backdrop-blur">
          <div className="space-y-4">
            <label className="block text-sm font-medium text-slate-200">
              Product link
            </label>
            <div className="flex flex-col sm:flex-row gap-3">
              <input
                type="url"
                value={link}
                onChange={(e) => setLink(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !isLoading) {
                    analyze();
                  }
                }}
                placeholder="Paste product link..."
                className="flex-1 rounded-xl bg-slate-950/60 border border-slate-700/80 px-3.5 py-2.5 text-sm placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition shadow-sm"
              />
              <button
                type="button"
                onClick={analyze}
                disabled={isLoading || !link.trim()}
                className="inline-flex items-center justify-center rounded-xl bg-indigo-500 px-4 py-2.5 text-sm font-medium text-white shadow-sm hover:bg-indigo-400 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-indigo-500 transition-colors"
              >
                {isLoading ? "Analyzing..." : "Analyze"}
              </button>
            </div>
            {error && (
              <p className="text-xs text-rose-400">
                {error}
              </p>
            )}
          </div>

          {result && (
            <div className="mt-6 border-t border-slate-800 pt-5 space-y-4">
              <h2 className="text-sm font-semibold text-slate-200 uppercase tracking-[0.16em]">
                Result
              </h2>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div className="bg-slate-950/60 border border-slate-800 rounded-xl p-4">
                  <p className="text-xs font-medium text-slate-400 uppercase tracking-wide">
                    Score
                  </p>
                  <p className="mt-1 text-xl font-semibold text-indigo-400">
                    {typeof result.score === "number" ? result.score : "--"}
                  </p>
                </div>
                <div className="bg-slate-950/60 border border-slate-800 rounded-xl p-4">
                  <p className="text-xs font-medium text-slate-400 uppercase tracking-wide">
                    Verdict
                  </p>
                  <p className="mt-1 text-base font-semibold">
                    {result.verdict || "--"}
                  </p>
                </div>
                <div className="bg-slate-950/60 border border-slate-800 rounded-xl p-4 sm:col-span-1">
                  <p className="text-xs font-medium text-slate-400 uppercase tracking-wide">
                    Reason
                  </p>
                  <p className="mt-1 text-sm text-slate-200">
                    {result.reason || "No reason provided."}
                  </p>
                </div>
              </div>
            </div>
          )}
        </div>

        <p className="text-[11px] text-center text-slate-500">
          Powered by Product Sniper. Results are estimates only and not financial
          advice.
        </p>
      </div>
    </main>
  );
}