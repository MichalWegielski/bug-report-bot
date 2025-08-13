"use client";

import { Paperclip, SendHorizonal, X } from "lucide-react";
import { useState, ChangeEvent, useRef, FormEvent, useEffect } from "react";
import Image from "next/image";

interface Message {
  role: "user" | "assistant";
  content: string;
}

export default function Home() {
  const [messages, setMessages] = useState<Message[]>([
    {
      role: "assistant",
      content:
        "Witaj! Jestem tu, aby pomóc Ci stworzyć zgłoszenie błędu. Opisz problem, który napotkałeś. Możesz też od razu załączyć zrzut ekranu.",
    },
  ]);
  const [input, setInput] = useState<string>("");
  const [isLoading, setIsLoading] = useState<boolean>(false);

  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!input.trim()) return;

    const newUserMessage: Message = { role: "user", content: input };
    const newMessages = [...messages, newUserMessage];

    setMessages(newMessages);
    setInput("");
    setIsLoading(true);

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          messages: newMessages.map((msg) => ({
            type: msg.role === "user" ? "human" : "ai",
            content: msg.content,
          })),
        }),
      });

      if (!response.ok) {
        throw new Error("Błąd serwera");
      }

      const result = await response.json();

      setMessages(result.messages);
    } catch (error) {
      console.error("Błąd podczas komunikacji z API:", error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleFileChange = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const allowedTypes = ["image/jpeg", "image/png"];
    if (!allowedTypes.includes(file.type)) {
      setError("Proszę wybrać plik w formacie JPG lub PNG.");
      setPreviewUrl(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
      return;
    }
    setError(null);
    const url = URL.createObjectURL(file);
    setPreviewUrl(url);
  };

  const handleRemovePreview = () => {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  return (
    <div className="h-screen w-screen flex justify-center items-center bg-gray-50 dark:bg-gray-900">
      <main className="w-3/4 h-4/5 rounded-xl flex flex-col bg-white dark:bg-gray-800">
        <header className="p-4 border-b dark:border-gray-700 shadow-sm">
          <h1 className="text-xl font-bold text-gray-800 dark:text-white">
            Bug Report Assistant
          </h1>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            Opisz problem, a ja pomogę Ci stworzyć raport.
          </p>
        </header>

        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {messages.map((msg, index) => (
            <div
              key={index}
              className={`flex items-start gap-3 ${
                msg.role === "user" ? "justify-end" : "justify-start"
              }`}
            >
              <div
                className={`${
                  msg.role === "user"
                    ? "bg-blue-500 text-white"
                    : "bg-gray-200 dark:bg-gray-700 text-gray-800 dark:text-gray-200"
                } p-4 rounded-lg max-w-lg`}
              >
                <p>{msg.content}</p>
              </div>
            </div>
          ))}
          <div ref={messagesEndRef} />
        </div>

        <footer className="p-4 border-t dark:border-gray-700">
          <div className="mb-2 px-2">
            {error && <p className="text-sm text-red-500">{error}</p>}
            {previewUrl && (
              <div className="relative inline-block">
                <Image
                  src={previewUrl}
                  alt="Podgląd obrazka"
                  width={80}
                  height={80}
                  className="rounded-lg h-20 w-20 object-cover"
                />
                <button
                  onClick={handleRemovePreview}
                  className="absolute -top-2 -right-2 bg-gray-700 hover:bg-gray-800 text-white rounded-full p-1"
                  aria-label="Usuń obrazek"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            )}
          </div>

          <form
            onSubmit={handleSubmit}
            className="relative flex items-center gap-2"
          >
            <label
              htmlFor="file-upload"
              className="p-3 rounded-full hover:bg-gray-100 dark:hover:bg-gray-700 cursor-pointer transition-colors"
            >
              <Paperclip className="w-5 h-5 text-gray-500 dark:text-gray-400" />
            </label>
            <input
              ref={fileInputRef}
              id="file-upload"
              type="file"
              className="hidden"
              onChange={handleFileChange}
              accept="image/png, image/jpeg"
            />

            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Opisz problem lub dodaj komentarz..."
              className="flex-1 w-full resize-none bg-gray-100 dark:bg-gray-700 border-transparent rounded-lg p-3 pr-12 text-gray-800 dark:text-gray-200 focus:ring-2 focus:ring-blue-500 focus:outline-none transition-shadow"
              rows={1}
              disabled={isLoading}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  handleSubmit(e);
                }
              }}
            />

            <button
              type="submit"
              className="absolute right-3 top-1/2 -translate-y-1/2 p-2 rounded-full bg-blue-600 text-white hover:bg-blue-700 transition-colors disabled:opacity-50"
              disabled={isLoading || !input.trim()}
            >
              <SendHorizonal className="w-5 h-5" />
            </button>
          </form>
        </footer>
      </main>
    </div>
  );
}
