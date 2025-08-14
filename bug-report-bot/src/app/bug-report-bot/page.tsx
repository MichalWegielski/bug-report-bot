"use client";

import { Paperclip, SendHorizonal, X } from "lucide-react";
import { useState, ChangeEvent, useRef, FormEvent, useEffect } from "react";
import Image from "next/image";
import ReactMarkdown from "react-markdown";

interface Message {
  role: "user" | "assistant";
  content: string;
  imageUrl?: string;
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

  const [threadId, setThreadId] = useState<string | null>(null);

  const [fileToSend, setFileToSend] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!input.trim() && !fileToSend) return;

    const formData = new FormData();
    formData.append("text", input);

    if (threadId) {
      formData.append("threadId", threadId);
    }

    if (fileToSend) {
      formData.append("image", fileToSend);
    }

    const newUserMessage: Message = { role: "user", content: input };
    setMessages((prev) => [...prev, newUserMessage]);
    setInput("");
    setFileToSend(null);
    setPreviewUrl(null);
    setIsLoading(true);

    try {
      const response = await fetch("/api/bug-report-bot/chat", {
        method: "POST",
        body: formData,
      });

      if (!response.ok) throw new Error("Błąd serwera");

      const result = await response.json();

      setMessages(result.messages);
      setThreadId(result.threadId);

      const lastMessage = result.messages[result.messages.length - 1];
      if (
        lastMessage?.role === "assistant" &&
        lastMessage.content.includes("Raport został wygenerowany")
      ) {
        setThreadId(null);
      }
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
      setFileToSend(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
      return;
    }
    setError(null);
    setFileToSend(file);
    const url = URL.createObjectURL(file);
    setPreviewUrl(url);
  };

  const handleRemovePreview = () => {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl(null);
    setFileToSend(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  return (
    <div className="h-screen w-screen flex justify-center items-center bg-gray-900">
      <main className="w-4/5 h-4/5 flex flex-col bg-white dark:bg-gray-800 rounded-xl">
        <header className="p-4 border-b dark:border-gray-700 shadow-sm">
          <h1
            className="text-xl font-bold bg-clip-text text-transparent"
            style={{
              backgroundImage:
                "linear-gradient(to right, #ff69b4 3%, #ff8c00 20%)",
            }}
          >
            Bug Report Assistant
          </h1>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            Opisz problem, a ja pomogę Ci stworzyć raport.
          </p>
        </header>

        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {messages.map((msg, index) => {
            const contentParts = msg.content.split("{{IMAGE_PLACEHOLDER}}");
            const textPart = contentParts[0];
            const hasImagePlaceholder = contentParts.length > 1;

            return (
              <div
                key={index}
                className={`flex items-start gap-3 ${
                  msg.role === "user" ? "justify-end" : "justify-start"
                }`}
              >
                <div
                  className={`${
                    msg.role === "user"
                      ? "bg-blue-500 text-white rounded-2xl"
                      : "bg-gray-200 dark:bg-gray-700 text-gray-800 dark:text-gray-200 rounded-2xl"
                  } p-4 max-w-lg`}
                >
                  <ReactMarkdown>{textPart}</ReactMarkdown>
                  {hasImagePlaceholder && msg.imageUrl && (
                    <img
                      src={msg.imageUrl}
                      alt="Załączony obraz"
                      className="rounded-lg max-w-xs mt-2"
                    />
                  )}
                  {msg.imageUrl &&
                    !hasImagePlaceholder &&
                    msg.role !== "assistant" && (
                      <img
                        src={msg.imageUrl}
                        alt="Załączony obraz"
                        className="rounded-lg max-w-xs mt-2"
                      />
                    )}
                </div>
              </div>
            );
          })}
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
              disabled={isLoading || (!input.trim() && !fileToSend)}
            >
              <SendHorizonal className="w-5 h-5" />
            </button>
          </form>
        </footer>
      </main>
    </div>
  );
}
