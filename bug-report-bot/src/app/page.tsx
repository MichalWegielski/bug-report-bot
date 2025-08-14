"use client";

import Link from "next/link";

export default function Home() {
  return (
    <div className="h-screen w-screen flex flex-col justify-center items-center bg-gray-900 text-white">
      <h1 className="text-4xl font-bold mb-8">
        Tutaj możesz przetestować różne boty
      </h1>
      <nav>
        <ul className="flex gap-4">
          <li>
            <Link
              href="/bug-report-bot"
              className="px-6 py-3 bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors"
            >
              Bug Report Assistant
            </Link>
          </li>
          {/* Tu w przyszłości można dodać linki do innych botów */}
        </ul>
      </nav>
    </div>
  );
}
