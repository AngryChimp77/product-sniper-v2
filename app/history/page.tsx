"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";

type HistoryAnalysis = {
  id: string;
  url: string;
  score: number;
  verdict: string;
  reason: string;
  title?: string | null;
  image_url?: string | null;
  price?: string | null;
  created_at?: string;
  date?: string;
};

export default function HistoryPage() {
  const [user, setUser] = useState<any>(null);
  const [analyses, setAnalyses] = useState<HistoryAnalysis[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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

  useEffect(() => {
    async function loadHistory() {
      if (!user) {
        setAnalyses([]);
        setIsLoading(false);
        return;
      }

      try {
        setIsLoading(true);
        setError(null);

        const { data, error } = await supabase
          .from("analyses")
          .select("*")
          .eq("user_id", user.id)
          .order("created_at", { ascending: false });

        if (error) {
          setError("Failed to load history.");
          setAnalyses([]);
          return;
        }

        const normalized =
          data?.map((item: any) => {
            const numericScore = Number(item.score);
            const score = Number.isNaN(numericScore) ? 0 : numericScore;

            return {
              ...item,
              score,
            } as HistoryAnalysis;
          }) ?? [];

        setAnalyses(normalized);
      } finally {
        setIsLoading(false);
      }
    }

    loadHistory();
  }, [user]);

  return (
    <main className="min-h-screen bg-slate-950 text-slate-100 flex items-center justify-center px-4">
      <div className="w-full max-w-3xl space-y-8">
        <div className="flex items-start justify-between">
          <div className="space-y-2">
            <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight">
              History
            </h1>
            <p className="text-sm text-slate-400">
              Review your recent product analyses and insights.
            </p>
          </div>
          <div className="flex items-center gap-3">
            <Link
              href="/"
              className="text-gray-400 hover:text-white text-sm underline-offset-4 hover:underline transition"
            >
              Back to analyzer
            </Link>
          </div>
        </div>

        <div className="bg-slate-900/60 border border-slate-800/80 rounded-2xl p-5 sm:p-6 shadow-xl shadow-slate-950/40 backdrop-blur">
          {!user && (
            <p className="text-sm text-slate-400">
              Please sign in on the main page to view your analysis history.
            </p>
          )}

          {user && isLoading && (
            <p className="text-sm text-slate-400">Loading history…</p>
          )}

          {user && !isLoading && error && (
            <p className="text-sm text-rose-400">{error}</p>
          )}

          {user && !isLoading && !error && analyses.length === 0 && (
            <p className="text-sm text-slate-400">
              No analyses yet. Run your first analysis from the main page.
            </p>
          )}

          {user && !isLoading && !error && analyses.length > 0 && (
            <div className="space-y-3 sm:space-y-4">
              {analyses.map((item) => {
                const created =
                  item.created_at || item.date || new Date().toISOString();
                const createdLabel = new Date(created).toLocaleString(
                  undefined,
                  {
                    month: "short",
                    day: "numeric",
                    year: "numeric",
                    hour: "2-digit",
                    minute: "2-digit",
                  }
                );

                const verdictClasses =
                  item.verdict === "WINNER"
                    ? "text-emerald-400 bg-emerald-400/10 border-emerald-400/30"
                    : item.verdict === "AVERAGE"
                    ? "text-amber-300 bg-amber-300/10 border-amber-300/30"
                    : "text-rose-400 bg-rose-400/10 border-rose-400/30";

                return (
                  <div
                    key={item.id}
                    className="flex flex-col sm:flex-row sm:items-center gap-4 rounded-xl bg-slate-950/60 border border-slate-800 hover:border-slate-700 hover:bg-slate-950/80 transition p-4"
                  >
                    <div className="flex items-center gap-4 flex-1 min-w-0">
                      {item.image_url ? (
                        <div className="h-14 w-14 rounded-lg overflow-hidden bg-slate-900 border border-slate-800 flex-shrink-0">
                          <img
                            src={item.image_url}
                            alt={item.title || item.url}
                            className="h-full w-full object-cover"
                          />
                        </div>
                      ) : (
                        <div className="h-14 w-14 rounded-lg bg-slate-900 border border-slate-800 flex items-center justify-center text-[11px] text-slate-500 flex-shrink-0">
                          No image
                        </div>
                      )}

                      <div className="flex-1 min-w-0 space-y-1">
                        <p className="text-sm font-medium text-slate-100 truncate">
                          {item.title || "Untitled product"}
                        </p>
                        <p className="text-xs text-slate-500 truncate">
                          {item.url}
                        </p>
                        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-slate-500">
                          {item.price && <span>{item.price}</span>}
                          <span className="h-1 w-1 rounded-full bg-slate-600" />
                          <span>{createdLabel}</span>
                        </div>
                      </div>
                    </div>

                    <div className="flex items-end sm:items-center justify-between sm:justify-end gap-3 sm:gap-4">
                      <div className="text-right">
                        <p className="text-[11px] text-slate-500 uppercase tracking-wide">
                          Score
                        </p>
                        <p className="text-lg font-semibold text-indigo-400">
                          {item.score}
                        </p>
                      </div>
                      <div className="text-right">
                        <p className="text-[11px] text-slate-500 uppercase tracking-wide">
                          Verdict
                        </p>
                        <span
                          className={`inline-flex mt-1 px-2 py-0.5 rounded-full border text-[11px] font-semibold tracking-wide uppercase ${verdictClasses}`}
                        >
                          {item.verdict}
                        </span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </main>
  );
}
