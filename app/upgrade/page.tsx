"use client";

export default function UpgradePage() {
  return (
    <main className="min-h-screen bg-slate-950 text-slate-100 flex items-center justify-center px-4">
      <div className="w-full max-w-3xl bg-slate-900/60 border border-slate-800/80 rounded-2xl p-6 sm:p-8 shadow-xl shadow-slate-950/40 backdrop-blur text-center space-y-6">
        <div className="space-y-2">
          <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight">
            Upgrade to Product Sniper Pro
          </h1>
          <p className="text-sm text-slate-400">
            Unlock higher limits and faster AI analysis for serious product hunters.
          </p>
        </div>

        <div className="space-y-3 text-left mx-auto max-w-sm">
          <h2 className="text-sm font-semibold text-slate-200 uppercase tracking-[0.16em]">
            What you get
          </h2>
          <ul className="space-y-2 text-sm text-slate-300">
            <li className="flex items-start gap-2">
              <span className="mt-1 h-1.5 w-1.5 rounded-full bg-purple-500" />
              <span>Unlimited product analyses</span>
            </li>
            <li className="flex items-start gap-2">
              <span className="mt-1 h-1.5 w-1.5 rounded-full bg-purple-500" />
              <span>Faster AI analysis queue</span>
            </li>
            <li className="flex items-start gap-2">
              <span className="mt-1 h-1.5 w-1.5 rounded-full bg-purple-500" />
              <span>Priority support</span>
            </li>
          </ul>
        </div>

        <div className="grid grid-cols-2 gap-6 mt-8 text-left">
          <div className="border border-gray-700 rounded-lg p-6">
            <h3 className="text-xl font-semibold mb-4">Free Plan</h3>
            <ul className="space-y-2 text-gray-300 text-sm">
              <li>20 product analyses per month</li>
              <li>Basic AI scoring</li>
              <li>Standard analysis speed</li>
              <li>Community support</li>
            </ul>
            <p className="mt-4 text-lg font-semibold">Free</p>
          </div>

          <div className="border border-purple-600 rounded-lg p-6 bg-purple-900/20">
            <h3 className="text-xl font-semibold mb-4">Pro Plan</h3>
            <ul className="space-y-2 text-gray-200 text-sm">
              <li>Unlimited product analyses</li>
              <li>Advanced AI evaluation</li>
              <li>Priority analysis speed</li>
              <li>Priority support</li>
            </ul>
            <p className="mt-4 text-lg font-semibold">$9 / month</p>
          </div>
        </div>

        <button className="bg-purple-600 hover:bg-purple-700 px-6 py-3 rounded-lg text-white font-semibold mt-2 w-full sm:w-auto">
          Start Pro Plan
        </button>
      </div>
    </main>
  );
}

