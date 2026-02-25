"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

type AnalysisResult = {
  score: number;
  verdict: string;
  reason: string;
};

type Analysis = {
  url: string;
  score: number;
  verdict: "WINNER" | "LOSER" | "AVERAGE";
  reason: string;
  date: string;
};

export default function Home() {
  const [link, setLink] = useState("");
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [recentAnalyses, setRecentAnalyses] = useState<Analysis[]>([]);
  const [user, setUser] = useState<any>(null);

  useEffect(() => {
    async function loadRecent() {
      const { data, error } = await supabase
        .from("analyses")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(3);

      if (!error && data) {
        const normalized = data.map((item: any) => {
          const numericScore = Number(item.score);
          const score = Number.isNaN(numericScore) ? 0 : numericScore;

          return {
            ...item,
            score,
          } as Analysis;
        });

        setRecentAnalyses(normalized);
      }
    }

    loadRecent();
  }, []);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      setUser(data.user);
    });

    const { data: listener } = supabase.auth.onAuthStateChange(
      (event, session) => {
        setUser(session?.user ?? null);
      }
    );

    return () => {
      listener.subscription.unsubscribe();
    };
  }, []);

  function loadRecentAnalysis(item: Analysis) {
    setResult({
      score: item.score,
      verdict: item.verdict,
      reason: item.reason,
    });

    setLink(item.url);
  }

  const reasonPreview =
    result?.reason && result.reason.length > 120
      ? `${result.reason.slice(0, 120)}…`
      : result?.reason || "No reason provided.";

  async function analyze() {
    if (!user) {
      setError("Please sign in with Google to analyze products.");
      return;
    }

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
      const numericScore = Number(data.score);
      const score = Number.isNaN(numericScore) ? 0 : numericScore;

      const normalizedResult: AnalysisResult = {
        score,
        verdict: data.verdict,
        reason: data.reason,
      };

      setResult(normalizedResult);

      const url = link;

      await supabase.from("analyses").insert({
        user_id: user.id,
        url,
        score,
        verdict: normalizedResult.verdict,
        reason: normalizedResult.reason,
        title: data.title,
        image_url: data.image_url,
        price: data.price,
      });
      const newAnalysis: Analysis = {
        url,
        score,
        verdict: normalizedResult.verdict as Analysis["verdict"],
        reason: normalizedResult.reason,
        date: new Date().toISOString(),
      };

      setRecentAnalyses((prev) => {
        const updated = [newAnalysis, ...prev].slice(0, 3);

        localStorage.setItem("product-sniper-recent", JSON.stringify(updated));

        return updated;
      });
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

  async function loginWithGoogle() {
    await supabase.auth.signInWithOAuth({
      provider: "google",
    });
  }

  async function logout() {
    await supabase.auth.signOut();
  }

  return (
    <main className="min-h-screen bg-slate-950 text-slate-100 flex items-center justify-center px-4">
      <div className="w-full max-w-xl space-y-8">
        <div className="flex items-start justify-between">
          <div className="space-y-3">
            <h1 className="text-3xl sm:text-4xl font-semibold tracking-tight">
              🚀 Product Sniper
            </h1>
            <p className="text-sm text-slate-400">
              Paste any product URL to instantly score its potential and get a
              clear verdict.
            </p>
          </div>
          <div className="flex items-center gap-3">
            {!user ? (
              <button
                onClick={loginWithGoogle}
                className="bg-indigo-600 hover:bg-indigo-500 text-white text-sm px-4 py-2 rounded-lg transition"
              >
                Sign in
              </button>
            ) : (
              <div className="flex items-center gap-3">
                <span className="text-xs text-gray-400 max-w-[180px] truncate text-right">
                  {user.email}
                </span>
                <button
                  onClick={logout}
                  className="text-gray-400 hover:text-white text-sm underline-offset-4 hover:underline transition"
                >
                  Logout
                </button>
              </div>
            )}
          </div>
        </div>

        {recentAnalyses.length > 0 && (
          <div className="mt-6 w-full max-w-xl">
            <h2 className="text-sm text-gray-400 mb-2">Recent Analyses</h2>
            <div className="bg-white/5 border border-white/10 rounded-xl divide-y divide-white/10">
              {recentAnalyses.map((item, index) => (
                <div
                  key={index}
                  onClick={() => loadRecentAnalysis(item)}
                  className="p-3 hover:bg-white/5 transition cursor-pointer"
                >
                  <div className="flex justify-between items-center gap-3">
                    <div className="text-xs text-gray-400 truncate max-w-[70%]">
                      {item.url.length > 40
                        ? `${item.url.slice(0, 40)}…`
                        : item.url}
                    </div>
                    <div className="flex items-center gap-3">
                      <div className="text-sm font-semibold">
                        {item.score}
                      </div>
                      <div
                        className={`text-xs font-semibold ${
                          item.verdict === "WINNER"
                            ? "text-green-400"
                            : item.verdict === "AVERAGE"
                            ? "text-yellow-300"
                            : "text-red-400"
                        }`}
                      >
                        {item.verdict}
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

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
                disabled={isLoading || !link.trim() || !user}
                className="inline-flex items-center justify-center rounded-xl bg-indigo-500 px-4 py-2.5 text-sm font-medium text-white shadow-sm hover:bg-indigo-400 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-indigo-500 transition-colors"
              >
                {isLoading
                  ? "Analyzing..."
                  : !user
                  ? "Login to analyze"
                  : "Analyze"}
              </button>
            </div>
            {!user && (
              <p className="text-xs text-gray-400">
                Please sign in with Google to analyze products and save your
                history.
              </p>
            )}
            {error && (
              <p className="text-xs text-rose-400">
                {error}
              </p>
            )}
          </div>

          {result && (
            <>
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
                  <div className="bg-slate-950/60 border border-slate-800 rounded-xl p-4 sm:col-span-1 flex flex-col justify-between gap-3">
                    <div>
                      <p className="text-xs font-medium text-slate-400 uppercase tracking-wide">
                        Reason
                      </p>
                      <p className="mt-1 text-sm text-slate-200 line-clamp-3">
                        {reasonPreview}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => setIsModalOpen(true)}
                      className="self-start text-xs font-medium text-indigo-400 hover:text-indigo-300 hover:underline underline-offset-4"
                    >
                      Read full analysis
                    </button>
                  </div>
                </div>
              </div>

              {isModalOpen && (
                <div
                  className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm"
                  onClick={() => setIsModalOpen(false)}
                >
                  <div
                    className="relative w-full max-w-xl sm:max-w-2xl mx-4 bg-slate-900 border border-slate-700 rounded-2xl shadow-2xl shadow-black/60 p-6 sm:p-7"
                    style={{ maxWidth: 600 }}
                    onClick={(e) => e.stopPropagation()}
                  >
                    <button
                      type="button"
                      onClick={() => setIsModalOpen(false)}
                      className="absolute top-3 right-3 inline-flex h-8 w-8 items-center justify-center rounded-full bg-slate-800/80 text-slate-300 hover:bg-slate-700 hover:text-white transition"
                      aria-label="Close"
                    >
                      ×
                    </button>
                    <h3 className="text-sm font-semibold text-slate-200 uppercase tracking-[0.16em] mb-3">
                      Full Analysis
                    </h3>
                    <div className="max-h-[60vh] overflow-y-auto pr-1">
                      <p className="text-base leading-relaxed text-slate-100 whitespace-pre-line">
                        {result.reason}
                      </p>
                    </div>
                  </div>
                </div>
              )}
            </>
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