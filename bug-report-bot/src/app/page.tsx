"use client";

import Link from "next/link";

export default function Home() {
  return (
    <div className="h-screen w-screen flex flex-col justify-center items-center bg-gray-900 text-white">
      <h1 className="text-4xl font-bold mb-8">
        Tutaj możesz przetestować różne boty
      </h1>
      <nav className="w-full max-w-6xl px-4">
        <ul className="grid grid-cols-3 gap-4">
          <li>
            <Link
              href="/bug-report-bot"
              className="block w-full p-6 bg-gray-800 border border-gray-700 rounded-lg transition-all hover:shadow-[0_0_15px_rgba(59,130,246,0.5)] text-center"
            >
              <h2 className="text-xl font-semibold mb-2">
                Bug Report Assistant
              </h2>
              <p className="text-gray-400">
                Stwórz szczegółowy raport błędu z pomocą AI
              </p>
            </Link>
          </li>
        </ul>
      </nav>
    </div>
  );
}
