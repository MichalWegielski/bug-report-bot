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
  screenshotAsked: Annotation<boolean>({
    reducer: (x, y) => y,
    default: () => false,
  }),
  screenshotDeclined: Annotation<boolean>({
    reducer: (x, y) => y,
    default: () => false,
  }),
  waitingForAdditional: Annotation<boolean>({
    reducer: (x, y) => y,
    default: () => false,
  }),
  additionalDeclined: Annotation<boolean>({
    reducer: (x, y) => y,
    default: () => false,
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
    screenshotAsked: true,
  };
};

const isNegativeResponse = async (msgContent: any): Promise<boolean> => {
  if (typeof msgContent !== "string") return false;

  const model = new ChatGoogleGenerativeAI({
    model: "gemini-1.5-flash-latest",
    temperature: 0,
  });

  const systemPrompt = new HumanMessage(
    `You are a strict classifier. Answer with single word YES if the following user reply is a refusal/decline (meaning they don't want or don't have what was requested). Answer NO otherwise.`
  );

  const res = await model.invoke([systemPrompt, new HumanMessage(msgContent)]);
  const ans = String(res.content).trim().toUpperCase();
  return ans.startsWith("Y");
};

const messageHasImage = (msg: BaseMessage): boolean => {
  return (
    Array.isArray(msg.content) &&
    (msg.content as any[]).some((part) => (part as any).type === "image_url")
  );
};

const handleScreenshotResponseNode = async (state: typeof AppState.State) => {
  console.log("Węzeł: analizuje czy dostalem screenashota");
  const lastUserMessage = state.messages[state.messages.length - 1];
  const hasImage = messageHasImage(lastUserMessage);

  if (hasImage) {
    console.log("Użytkownik dostarczył screenshot.");
    return { imageProvided: true };
  }

  if (await isNegativeResponse(lastUserMessage.content)) {
    console.log("Użytkownik odmówił dostarczenia screena.");
    return { screenshotDeclined: true };
  }

  console.log(
    "Użytkownik nie dostarczył screena, ale napisał tekst. Traktuję to jako dodatkowe info."
  );
  return {
    screenshotDeclined: true,
    additionalInfo: String(lastUserMessage.content),
  };
};

const askForFinalInfoNode = async (state: typeof AppState.State) => {
  console.log("Węzeł: proszę o dodatkowe informacje.");
  const responseMessage = new AIMessage(
    "Świetnie, mam już prawie wszystko. Czy chcesz dodać jeszcze jakieś informacje, zanim wygeneruję raport?"
  );

  return {
    messages: [responseMessage],
    waitingForAdditional: true,
  };
};

const handleFinalInfoNode = async (state: typeof AppState.State) => {
  console.log("Węzeł: przetwarzam końcowe informacje.");
  const lastUserMessage = state.messages[state.messages.length - 1];
  const finalInfo = String(lastUserMessage.content);
  console.log("Dodatkowe informacje od użytkownika:", finalInfo);

  if (await isNegativeResponse(finalInfo)) {
    return {
      additionalDeclined: true,
      waitingForAdditional: false,
    };
  }

  return {
    additionalInfo: [state.additionalInfo, finalInfo]
      .filter(Boolean)
      .join("\n"),
    waitingForAdditional: false,
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
    messages: [
      new AIMessage({ content: String(response.content) }),
      new AIMessage({
        content:
          "Raport został wygenerowany ✅\n\nCzy mogę pomóc w czymś jeszcze? Jeśli tak, po prostu napisz kolejny opis błędu, a rozpoczniemy nowy wątek.",
      }),
    ],
  };
};

const masterRouter = (state: typeof AppState.State) => {
  console.log("--- Master Router Deciding ---");
  const {
    initialDescription,
    imageProvided,
    screenshotAsked,
    screenshotDeclined,
    waitingForAdditional,
    additionalInfo,
    additionalDeclined,
  } = state;

  console.log("Current state:", {
    initialDescription: !!initialDescription,
    imageProvided,
    screenshotAsked,
    screenshotDeclined,
    waitingForAdditional,
    additionalInfo: !!additionalInfo,
    additionalDeclined,
  });

  if (!initialDescription) {
    console.log("Decision: initial_analyzer");
    return "initial_analyzer";
  }

  const screenshotPhaseOver = imageProvided || screenshotDeclined;

  if (screenshotAsked && !screenshotPhaseOver) {
    console.log("Decision: handle_screenshot_response");
    return "handle_screenshot_response";
  }

  if (screenshotPhaseOver) {
    const finalInfoPhaseOver = additionalInfo || additionalDeclined;
    if (finalInfoPhaseOver) {
      console.log("Decision: generate_report");
      return "generate_report";
    }
    if (waitingForAdditional) {
      console.log("Decision: handle_final_info");
      return "handle_final_info";
    }
    console.log("Decision: ask_for_final_info");
    return "ask_for_final_info";
  }

  console.log("Router fallback to ask_for_screenshot");
  return "ask_for_screenshot";
};

const app = new StateGraph(AppState)
  .addNode("initial_analyzer", analyzeInitialPrompt)
  .addNode("ask_for_screenshot", askForScreenshotNode)
  .addNode("handle_screenshot_response", handleScreenshotResponseNode)
  .addNode("ask_for_final_info", askForFinalInfoNode)
  .addNode("handle_final_info", handleFinalInfoNode)
  .addNode("generate_report", generateReportNode)
  .addConditionalEdges(START, masterRouter)
  .addConditionalEdges("initial_analyzer", masterRouter)
  .addConditionalEdges("handle_screenshot_response", masterRouter)
  .addConditionalEdges("handle_final_info", masterRouter)
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
      messages: result.messages.map((msg: BaseMessage) => {
        let textContent = "";
        let imageUrl: string | undefined = undefined;

        if (Array.isArray(msg.content)) {
          const textParts = msg.content.filter(
            (part) => (part as any).type === "text"
          );
          const imageParts = msg.content.filter(
            (part) => (part as any).type === "image_url"
          );

          textContent = textParts.map((part: any) => part.text).join("\n");

          if (imageParts.length > 0) {
            const imagePart = imageParts[0] as any;
            if (typeof imagePart.image_url === "string") {
              imageUrl = imagePart.image_url;
            } else if (
              typeof imagePart.image_url === "object" &&
              imagePart.image_url !== null
            ) {
              imageUrl = imagePart.image_url.url;
            }
          }
        } else {
          textContent = String(msg.content);
        }

        return {
          role: msg instanceof HumanMessage ? "user" : "assistant",
          content: textContent,
          imageUrl: imageUrl,
        };
      }),
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
