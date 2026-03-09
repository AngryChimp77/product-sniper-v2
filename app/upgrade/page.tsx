"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

type User = {
  id: string;
  email: string;
};

async function handleUpgrade(user: User) {
  try {
    const res = await fetch("/api/create-checkout-session", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        userId: user.id,
        email: user.email,
      }),
    });

    if (!res.ok) {
      console.error("Failed to start checkout", await res.text());
      return;
    }

    const data = (await res.json()) as { url?: string };

    if (!data.url) {
      console.error("No checkout URL returned from API");
      return;
    }

    window.location.href = data.url;
  } catch (error) {
    console.error("Error starting checkout", error);
  }
}

export default function UpgradePage() {
  const [user, setUser] = useState<User | null>(null);
  const [isLoadingUser, setIsLoadingUser] = useState(true);

  useEffect(() => {
    let isMounted = true;

    const loadUser = async () => {
      try {
        const { data, error } = await supabase.auth.getUser();
        if (error) {
          console.error("Error fetching Supabase user", error);
        }

        if (!isMounted) return;

        if (data?.user) {
          setUser({
            id: data.user.id,
            email: data.user.email ?? "",
          });
        } else {
          setUser(null);
        }
      } catch (err) {
        if (!isMounted) return;
        console.error("Unexpected error fetching Supabase user", err);
        setUser(null);
      } finally {
        if (isMounted) {
          setIsLoadingUser(false);
        }
      }
    };

    void loadUser();

    return () => {
      isMounted = false;
    };
  }, []);

  return (
    <main className="min-h-screen bg-slate-950 text-slate-100 flex items-center justify-center px-4">
      <div className="w-full max-w-md bg-slate-900/60 border border-slate-800/80 rounded-2xl p-6 sm:p-8 shadow-xl shadow-slate-950/40 backdrop-blur text-center space-y-6">
        <a
          href="/"
          className="text-sm text-gray-400 hover:text-white mb-6 inline-block"
        >
          ← Back to Product Sniper
        </a>
        <div className="space-y-2">
          <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight">
            Upgrade to Product Sniper Pro
          </h1>
          <p className="text-sm text-slate-400">
            Unlock unlimited analyses and faster insights for your winning products.
          </p>
        </div>

        <div className="space-y-4">
          <p className="text-3xl font-semibold text-purple-400">$9/month</p>
          <ul className="space-y-2 text-sm text-slate-300 text-left mx-auto max-w-xs">
            <li>Unlimited product analyses</li>
            <li>Faster AI scoring</li>
            <li>Priority updates</li>
          </ul>
        </div>

        <button
          className="bg-purple-600 hover:bg-purple-700 px-6 py-3 rounded-lg text-white font-semibold mt-6 w-full"
          disabled={isLoadingUser || !user}
          onClick={() => {
            if (!user) {
              console.error("User not available for upgrade");
              return;
            }
            void handleUpgrade(user);
          }}
        >
          Upgrade to Pro
        </button>
      </div>
    </main>
  );
}

