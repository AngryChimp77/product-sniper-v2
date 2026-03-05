"use client";

export default function UpgradePage() {
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
          onClick={() => {
            console.log("Upgrade clicked");
          }}
        >
          Upgrade to Pro
        </button>
      </div>
    </main>
  );
}

