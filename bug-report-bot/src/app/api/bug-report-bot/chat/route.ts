import { NextResponse } from "next/server";
import { StateGraph, Annotation, START, END } from "@langchain/langgraph";
import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { BaseMessage, HumanMessage, AIMessage } from "@langchain/core/messages";
import { MemorySaver } from "@langchain/langgraph";
import { z } from "zod";
import { InitialAnalysisSchema } from "./schemas/initial-analysis.schema";
import { FinalInfoQualitySchema } from "./schemas/final-info-quality.schema";
import { ReportSchema } from "./schemas/report.schema";

const memory = new MemorySaver();

const creativeModel = new ChatGoogleGenerativeAI({
  model: "gemini-1.5-flash-latest",
  temperature: 0.7,
});

const analyticalModel = new ChatGoogleGenerativeAI({
  model: "gemini-1.5-flash-latest",
  temperature: 0,
});

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
  initialAnalysisQuality: Annotation<"good" | "bad">({
    reducer: (x, y) => y,
  }),
  finalInfoQuality: Annotation<"POSITIVE" | "NEGATIVE" | "UNCLEAR">({
    reducer: (x, y) => y,
  }),
});

const invokeClassificationModel = async (
  userMessage: BaseMessage | string,
  systemPrompt: string
): Promise<string> => {
  const messageContent =
    typeof userMessage === "string"
      ? new HumanMessage(userMessage)
      : userMessage;
  const response = await analyticalModel.invoke([
    new HumanMessage(systemPrompt),
    messageContent,
  ]);
  return String(response.content).trim().toUpperCase();
};

const analyzeInitialPrompt = async (state: typeof AppState.State) => {
  console.log("Analizuję pierwsze zapytanie (z oceną jakości)...");

  const lastUserMessage = state.messages[state.messages.length - 1];

  const analysisPrompt = new HumanMessage(
    `You are a QA assistant. Your task is to assess the quality of the first bug report description from a user, which may include text and/or an image.
1.  Assess: Does the combination of text and image contain any meaningful information that could relate to a software problem? A screenshot alone is sufficient if it clearly shows a potential issue. Ignore greetings.
2.  Summarize: If the assessment is 'good', provide a brief summary of the problem based on all available information. If 'bad', do not create a summary.

Respond with a JSON object with two keys: "assessment" (which can be "good" or "bad") and "summary" (a string, empty if assessment is "bad").
Example for a good report: {"assessment": "good", "summary": "User reports that the login button is unresponsive on the main page."}
Example for a bad report: {"assessment": "bad", "summary": ""}`
  );

  const response = await creativeModel.invoke([
    analysisPrompt,
    lastUserMessage,
  ]);
  const responseText = String(response.content)
    .replace(/```json|```/g, "")
    .trim();
  console.log("Odpowiedź analityczna modelu (JSON):", responseText);

  let quality: "good" | "bad" = "bad";
  let summary = "";

  try {
    const parsedJson = JSON.parse(responseText);
    const validatedData = InitialAnalysisSchema.parse(parsedJson);
    quality = validatedData.assessment;
    summary = validatedData.summary;
  } catch (e) {
    console.error("Błąd parsowania lub walidacji JSON:", e);
    if (responseText.toUpperCase().includes("GOOD")) {
      quality = "good";
    }
  }

  const hasImage = messageHasImage(lastUserMessage);

  return {
    initialDescription: summary,
    imageProvided: hasImage,
    initialAnalysisQuality: quality,
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

  const systemPrompt = `You are a strict classifier. Answer with a single word YES if the following user reply is a refusal/decline (meaning they don't want or don't have what was requested). Answer NO otherwise.`;

  const ans = await invokeClassificationModel(msgContent, systemPrompt);
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

const triage_final_info_node = async (state: typeof AppState.State) => {
  console.log("Node: classifying intent of the final response.");
  const lastUserMessage = state.messages[state.messages.length - 1];

  const triagePrompt = `Jesteś klasyfikatorem intencji. Użytkownik odpowiedział na pytanie 'Czy chcesz dodać coś jeszcze?'. Przeanalizuj jego odpowiedź i zaklasyfikuj ją do jednej z trzech kategorii:

POSITIVE: Użytkownik dostarcza nowych, sensownych informacji (tekst lub obraz).
NEGATIVE: Użytkownik odmawia dodania informacji (np. 'nie', 'to wszystko', 'generuj raport').
UNCLEAR: Odpowiedź jest bez sensu, to losowe znaki, wulgaryzmy lub jest zbyt niejasna, by ją zrozumieć.

Odpowiedz tylko jednym słowem: POSITIVE, NEGATIVE, lub UNCLEAR.`;

  const classificationResult = await invokeClassificationModel(
    lastUserMessage,
    triagePrompt
  );

  try {
    const validatedQuality = FinalInfoQualitySchema.parse(classificationResult);
    console.log("Classification result:", validatedQuality);
    return {
      finalInfoQuality: validatedQuality,
      waitingForAdditional: false,
    };
  } catch (e) {
    console.error("Nieznana kategoria od modelu:", classificationResult, e);
    return {
      finalInfoQuality: "UNCLEAR",
      waitingForAdditional: false,
    };
  }
};

const finalinfo_clarification_node = async (state: typeof AppState.State) => {
  console.log("Node: asking for clarification of an unclear response.");

  const history = state.messages;

  const clarifyFinalInfoPrompt = new HumanMessage(
    `Jestes QA asystentem. Wygeneruj wiadomość, która zostanie wysłana do użytkownika. Odpowiedz po polsku, na to ze uzytkownik dostarczyl wiadomosc o niejasnym charakterze.`
  );

  const response = await creativeModel.invoke([
    ...history,
    clarifyFinalInfoPrompt,
  ]);
  const responseText = String(response.content);

  const responseMessage = new AIMessage({ content: responseText });

  return {
    messages: [responseMessage],
    waitingForAdditional: true,
  };
};

const analyzeAdditionalInfoNode = async (state: typeof AppState.State) => {
  console.log("Węzeł: analizuję dodatkowe informacje (w tym obraz).");

  const lastUserMessage = state.messages[state.messages.length - 1];
  const analysisPrompt = new HumanMessage(
    "Przeanalizuj poniższą, dodatkową wiadomość (może zawierać tekst i/lub obraz) i streść zawarte w niej informacje w kontekście zgłoszenia błędu."
  );

  const response = await analyticalModel.invoke([
    analysisPrompt,
    lastUserMessage,
  ]);
  const analyzedInfo = String(response.content);
  console.log("Przeanalizowane dodatkowe info:", analyzedInfo);

  const hasImage = messageHasImage(lastUserMessage);

  return {
    additionalInfo: [state.additionalInfo, analyzedInfo]
      .filter(Boolean)
      .join("\n\n"),
    waitingForAdditional: false,
    imageProvided: state.imageProvided || hasImage,
  };
};

const generateReportNode = async (state: typeof AppState.State) => {
  console.log("Węzeł: generuję raport błędu.");

  const { initialDescription, imageAnalysis, additionalInfo } = state;

  const userImageMessages = state.messages.filter(messageHasImage);
  const imageCount = userImageMessages.length;

  const reportPrompt = `
    Jesteś doświadczonym analitykiem QA. Twoim zadaniem jest przekształcenie poniższych, luźnych notatek od użytkownika w profesjonalny, ustrukturyzowany raport błędu w formacie JSON.
    
    **Twoje zadania:**
    1.  **Stwórz zwięzły, techniczny tytuł**.
    2.  **Wypełnij pola obiektu JSON** na podstawie dostępnych danych.
    3.  Jeśli jakaś informacja nie została podana (np. URL, dokładne kroki), **pozostaw to pole jako puste lub pomiń je**, zgodnie ze schematem. Nie wymyślaj danych.
    4.  Dokonaj **krótkiej, technicznej analizy** w polu "technicalAnalysis".

    **Dane wejściowe od użytkownika:**
    -   **Początkowy opis:** ${initialDescription}
    -   **Analiza obrazu (jeśli jest):** ${imageAnalysis || "Brak"}
    -   **Dodatkowe informacje:** ${additionalInfo || "Brak"}

    **Schemat JSON, którego musisz przestrzegać:**
    \`\`\`json
    {
      "title": "string",
      "environment": { "url": "string", "browser": "string", "os": "string" },
      "stepsToReproduce": ["string"],
      "expectedResult": "string",
      "actualResult": "string",
      "technicalAnalysis": "string"
    }
    \`\`\`
    
    Zwróć TYLKO i WYŁĄCZNIE poprawny obiekt JSON, bez żadnych dodatkowych opisów czy formatowania.`;

  const response = await creativeModel.invoke([new HumanMessage(reportPrompt)]);
  const responseText = String(response.content)
    .replace(/```json|```/g, "")
    .trim();
  console.log("Wygenerowany raport (JSON):", responseText);

  let reportContent =
    "Przepraszamy, wystąpił błąd podczas generowania raportu.";
  try {
    const parsedJson = JSON.parse(responseText);
    const validatedReport = ReportSchema.parse(parsedJson);

    const markdownReport = `
**Tytuł:** ${validatedReport.title}

---

**Środowisko:**
-   **URL:** ${
      validatedReport.environment?.url || "[URL do uzupełnienia przez zespół]"
    }
-   **Przeglądarka:** ${
      validatedReport.environment?.browser ||
      "[Do uzupełnienia na podstawie informacji od użytkownika, jeśli dostępne]"
    }
-   **System operacyjny:** ${
      validatedReport.environment?.os ||
      "[Do uzupełnienia na podstawie informacji od użytkownika, jeśli dostępne]"
    }

---

**Kroki do odtworzenia:**
${validatedReport.stepsToReproduce
  .map((step, i) => `${i + 1}. ${step}`)
  .join("\n")}

---

**Oczekiwany rezultat:**
${validatedReport.expectedResult}

---

**Rzeczywisty rezultat:**
${validatedReport.actualResult}

---

**Dodatkowe informacje i analiza:**
${validatedReport.technicalAnalysis}

---

**Załączniki:**
${
  imageCount > 0
    ? `Liczba załączników: ${imageCount}. Znajdziesz je dołączone do tej wiadomości.`
    : "Brak załączników."
}
    `;
    reportContent = markdownReport.trim();
  } catch (e) {
    console.error("Błąd parsowania lub walidacji JSON raportu:", e);
  }

  const imageUrls: string[] = [];

  for (const msg of userImageMessages) {
    if (Array.isArray(msg.content)) {
      const imagePart = msg.content.find(
        (part) => (part as any).type === "image_url"
      ) as any;
      if (imagePart?.image_url?.url) {
        imageUrls.push(imagePart.image_url.url);
      }
    }
  }

  const reportMessageContent: any = [{ type: "text", text: reportContent }];
  for (const url of imageUrls) {
    reportMessageContent.push({
      type: "image_url",
      image_url: { url: url },
    });
  }

  return {
    messages: [
      new AIMessage({
        content: "Poniżej zobaczysz wygenerowany raport błędu.",
      }),
      new AIMessage({ content: reportMessageContent }),
      new AIMessage({
        content:
          "Raport został wygenerowany ✅\n\nCzy mogę pomóc w czymś jeszcze? Jeśli tak, po prostu napisz kolejny opis błędu, a rozpoczniemy nowy wątek.",
      }),
    ],
  };
};

const repromptNode = async (state: typeof AppState.State) => {
  console.log("Węzeł: proszę o lepszy opis.");

  const history = state.messages;

  const answerBadQualityPrompt = new HumanMessage(
    `Jesteś asystentem AI. Twoim zadaniem jest grzeczne poinformowanie użytkownika, że jego ostatnia wiadomość jest niewystarczająca lub niezrozumiała do stworzenia raportu błędu. Poproś o więcej szczegółów. 
    Przeanalizuj historię rozmowy, aby zobaczyć, co już zostało powiedziane i sformułuj prośbę inaczej niż poprzednio.
    Odpowiedz krótko (maksymalnie 2 zdania), po polsku, w uprzejmym tonie.`
  );

  const response = await creativeModel.invoke([
    ...history,
    answerBadQualityPrompt,
  ]);
  const responseText = String(response.content);

  const responseMessage = new AIMessage({ content: responseText });

  return {
    messages: [responseMessage],
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
    initialAnalysisQuality: state.initialAnalysisQuality,
    imageProvided,
    screenshotAsked,
    screenshotDeclined,
    waitingForAdditional,
    additionalInfo: !!additionalInfo,
    additionalDeclined,
    finalInfoQuality: state.finalInfoQuality,
  });

  if (!initialDescription) {
    console.log("Decision: initial_analyzer");
    return "initial_analyzer";
  }

  if (state.initialAnalysisQuality === "bad") {
    console.log("Decision: initial_analyzer (re-prompt loop)");
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
      console.log("Decision: triage_final_info_node");
      return "triage_final_info_node";
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
  .addNode("triage_final_info_node", triage_final_info_node)
  .addNode("finalinfo_clarification_node", finalinfo_clarification_node)
  .addNode("analyze_additional_info", analyzeAdditionalInfoNode)
  .addNode("reprompt_node", repromptNode)
  .addNode("generate_report", generateReportNode)
  .addConditionalEdges(START, masterRouter)
  .addConditionalEdges("initial_analyzer", (state) => {
    if (state.initialAnalysisQuality === "good") {
      return masterRouter(state);
    }
    return "reprompt_node";
  })
  .addConditionalEdges("handle_screenshot_response", masterRouter)
  .addConditionalEdges("triage_final_info_node", (state) => {
    switch (state.finalInfoQuality) {
      case "POSITIVE":
        return "analyze_additional_info";
      case "NEGATIVE":
        return "generate_report";
      case "UNCLEAR":
        return "finalinfo_clarification_node";
      default:
        return "finalinfo_clarification_node";
    }
  })
  .addConditionalEdges("reprompt_node", masterRouter)
  .addEdge("analyze_additional_info", "generate_report")
  .addEdge("generate_report", END)
  .compile({
    interruptAfter: [
      "ask_for_screenshot",
      "ask_for_final_info",
      "reprompt_node",
      "finalinfo_clarification_node",
    ],
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
        const message: {
          role: "user" | "assistant";
          content: string;
          imageUrls?: string[];
        } = {
          role: msg instanceof HumanMessage ? "user" : "assistant",
          content: "",
        };

        if (Array.isArray(msg.content)) {
          const textParts = msg.content.filter(
            (part) => (part as any).type === "text"
          );
          const imageParts = msg.content.filter(
            (part) => (part as any).type === "image_url"
          );

          message.content = textParts.map((part: any) => part.text).join("\\n");
          message.imageUrls = imageParts
            .map((part: any) => {
              if (typeof part.image_url === "string") {
                return part.image_url;
              }
              if (typeof part.image_url === "object" && part.image_url?.url) {
                return part.image_url.url;
              }
              return null;
            })
            .filter((url): url is string => url !== null);
        } else {
          message.content = String(msg.content);
        }

        return message;
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
