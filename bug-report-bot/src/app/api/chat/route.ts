import { NextResponse } from "next/server";
import { StateGraph, Annotation, START, END } from "@langchain/langgraph";
import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { BaseMessage, HumanMessage, AIMessage } from "@langchain/core/messages";
import { MemorySaver } from "@langchain/langgraph";

const memory = new MemorySaver();

const AppState = Annotation.Root({
  messages: Annotation<BaseMessage[]>({
    reducer: (x, y) => x.concat(y),
    default: () => [],
  }),
  initialDescription: Annotation<string>({
    reducer: (x, y) => y,
  }),
  imageProvided: Annotation<boolean>({
    reducer: (x, y) => y,
    default: () => false,
  }),
  imageAnalysis: Annotation<string>({
    reducer: (x, y) => y,
  }),
  additionalInfo: Annotation<string>({
    reducer: (x, y) => y,
  }),
});

const analyzeInitialPrompt = async (state: typeof AppState.State) => {
  console.log("Analizuję pierwsze zapytanie...");

  const model = new ChatGoogleGenerativeAI({
    model: "gemini-1.5-flash-latest",
    temperature: 0,
  });

  const lastUserMessage = state.messages[state.messages.length - 1];

  const hasImage =
    Array.isArray(lastUserMessage.content) &&
    lastUserMessage.content.some((part) => (part as any).type === "image_url");

  const analysisPrompt = new HumanMessage(
    "Przeanalizuj poniższe zgłoszenie błędu. Zidentyfikuj i opisz krótko problem. Jeśli jest załączony obraz, opisz co na nim widać w kontekście zgłoszenia."
  );

  const response = await model.invoke([analysisPrompt, lastUserMessage]);

  console.log("Odpowiedź analityczna modelu:", response.content);

  return {
    initialDescription: String(response.content),
    imageProvided: hasImage,
  };
};

const askForScreenshotNode = async (state: typeof AppState.State) => {
  console.log("Węzeł: proszę o screenshot.");
  const responseMessage = new AIMessage(
    "Dzięki za opis! Czy masz może zrzut ekranu, który mógłbyś załączyć? To bardzo pomaga w analizie."
  );

  return {
    messages: [responseMessage],
  };
};

const handleScreenshotResponseNode = async (state: typeof AppState.State) => {
  console.log("Węzeł: analizuje czy dostalem screenashota");
  const lastUserMessage = state.messages[state.messages.length - 1];
  const hasImage =
    Array.isArray(lastUserMessage.content) &&
    lastUserMessage.content.some((part) => (part as any).type === "image_url");

  if (hasImage) {
    console.log("Użytkownik dostarczył screenshot.");
    return { imageProvided: true };
  } else {
    console.log("Użytkownik nie dostarczył screenshota.");
    return {};
  }
};

const askForFinalInfoNode = async (state: typeof AppState.State) => {
  console.log("Węzeł: proszę o dodatkowe informacje.");
  const responseMessage = new AIMessage(
    "Świetnie, mam już prawie wszystko. Czy chcesz dodać jeszcze jakieś informacje, zanim wygeneruję raport?"
  );

  return {
    messages: [responseMessage],
  };
};

const handleFinalInfoNode = async (state: typeof AppState.State) => {
  console.log("Węzeł: przetwarzam końcowe informacje.");
  const lastUserMessage = state.messages[state.messages.length - 1];
  const finalInfo = String(lastUserMessage.content);
  console.log("Dodatkowe informacje od użytkownika:", finalInfo);
  return {
    additionalInfo: finalInfo,
  };
};

const generateReportNode = async (state: typeof AppState.State) => {
  console.log("Węzeł: generuję raport błędu.");
  const model = new ChatGoogleGenerativeAI({
    model: "gemini-1.5-flash-latest",
    temperature: 0,
  });

  const { initialDescription, imageProvided, imageAnalysis, additionalInfo } =
    state;

  const reportPrompt = `
    Wygeneruj zwięzły i dobrze sformatowany raport błędu na podstawie poniższych informacji. Użyj markdown.

    **Opis problemu:**
    ${initialDescription}

    **Czy załączono zrzut ekranu?**
    ${imageProvided ? "Tak" : "Nie"}

    ${imageAnalysis ? `**Analiza zrzutu ekranu:**\n${imageAnalysis}` : ""}

    **Dodatkowe informacje od użytkownika:**
    ${additionalInfo || "Brak."}

    Raport powinien być gotowy do przekazania zespołowi deweloperskiemu.
  `;

  const response = await model.invoke([new HumanMessage(reportPrompt)]);
  console.log("Wygenerowany raport:", response.content);

  return {
    messages: [new AIMessage({ content: String(response.content) })],
  };
};

const shouldAskForScreenshot = (state: typeof AppState.State) => {
  console.log(
    "Router decyduje na podstawie flagi imageProvided:",
    state.imageProvided
  );
  if (state.imageProvided) {
    console.log("Obraz dostarczony, przechodzę do końca (na razie).");
    return "ask_for_final_info";
  } else {
    console.log("Brak obrazu, proszę o screenshot (na razie kończę).");
    return "ask_for_screenshot";
  }
};

const app = new StateGraph(AppState)
  .addNode("initial_analyzer", analyzeInitialPrompt)
  .addNode("ask_for_screenshot", askForScreenshotNode)
  .addNode("handle_screenshot_response", handleScreenshotResponseNode)
  .addNode("ask_for_final_info", askForFinalInfoNode)
  .addNode("handle_final_info", handleFinalInfoNode)
  .addNode("generate_report", generateReportNode)
  .addEdge(START, "initial_analyzer")
  .addConditionalEdges("initial_analyzer", shouldAskForScreenshot, {
    ask_for_screenshot: "ask_for_screenshot",
    ask_for_final_info: "ask_for_final_info",
  })
  .addEdge("ask_for_screenshot", "handle_screenshot_response")
  .addEdge("handle_screenshot_response", "ask_for_final_info")
  .addEdge("ask_for_final_info", "handle_final_info")
  .addEdge("handle_final_info", "generate_report")
  .addEdge("generate_report", END)
  .compile({
    interruptAfter: ["ask_for_screenshot", "ask_for_final_info"],
    checkpointer: memory,
  });

export async function POST(req: Request) {
  try {
    const formData = await req.formData();
    const text = (formData.get("text") as string) || "";
    const imageFile = formData.get("image") as File | null;
    const previousMessagesString = formData.get("messages") as string;
    const previousMessages = previousMessagesString
      ? JSON.parse(previousMessagesString)
      : [];
    let threadId = formData.get("threadId") as string | null;

    if (!threadId) {
      threadId = crypto.randomUUID();
      console.log("Rozpoczynam nowy wątek:", threadId);
    } else {
      console.log("Kontynuuję wątek:", threadId);
    }

    let userMessageContent: any = text;

    if (imageFile) {
      const buffer = Buffer.from(await imageFile.arrayBuffer());
      const base64 = buffer.toString("base64");
      userMessageContent = [
        { type: "text", text },
        {
          type: "image_url",
          image_url: { url: `data:${imageFile.type};base64,${base64}` },
        },
      ];
    }

    const result = await app.invoke(
      { messages: [new HumanMessage({ content: userMessageContent })] },
      { configurable: { thread_id: threadId } }
    );

    const formattedResult = {
      messages: result.messages.map((msg: BaseMessage) => ({
        role: msg instanceof HumanMessage ? "user" : "assistant",
        content: String(msg.content),
      })),
      threadId: threadId,
    };
    return NextResponse.json(formattedResult);
  } catch (e: any) {
    console.error("Błąd w API Route:", e);
    return NextResponse.json(
      { error: e.message || "Wystąpił nieznany błąd serwera." },
      { status: 500 }
    );
  }
}
