"use client";

import { Paperclip, SendHorizonal, X } from "lucide-react";
import { useState, ChangeEvent, useRef, FormEvent, useEffect } from "react";
import Image from "next/image";
import ReactMarkdown from "react-markdown";
import Spinner from "./Spinner";

interface Message {
  role: "user" | "assistant";
  content: string;
  imageUrls?: string[];
}

export default function Home() {
  const [messages, setMessages] = useState<Message[]>([
    {
      role: "assistant",
      content:
        "Jestem tu, aby pomóc Ci stworzyć zgłoszenie błędu. Opisz problem, który napotkałeś, lub od razu załącz zrzut ekranu, aby rozpocząć.",
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

    const newUserMessage: Message = {
      role: "user",
      content: input,
      imageUrls: previewUrl ? [previewUrl] : undefined,
    };
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

        <div
          className={`flex-1 overflow-y-auto p-6 ${
            messages.length > 1 ? "space-y-6" : "flex flex-col"
          }`}
        >
          {messages.length === 1 ? (
            <div className="flex-1 flex justify-center items-center">
              <div className="text-center max-w-md">
                <h2
                  className="text-2xl font-bold bg-clip-text text-transparent"
                  style={{
                    backgroundImage:
                      "linear-gradient(to right, #ff69b4 40%, #ff8c00 60%)",
                  }}
                >
                  Bug Report Assistant
                </h2>
                <p className="mt-2 text-gray-500 dark:text-gray-400">
                  {messages[0].content}
                </p>
              </div>
            </div>
          ) : (
            messages.map(
              (msg, index) =>
                index > 0 && (
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
                      {msg.content && (
                        <ReactMarkdown>{msg.content}</ReactMarkdown>
                      )}
                      {msg.imageUrls && msg.imageUrls.length > 0 && (
                        <div className="mt-2 flex flex-col gap-2">
                          {msg.imageUrls.map((url, i) => (
                            <img
                              key={i}
                              src={url}
                              alt={`Załączony obraz ${i + 1}`}
                              className="rounded-lg max-w-xs"
                            />
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                )
            )
          )}
          {isLoading && <Spinner />}
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
