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
  initialAnalysisQuality: Annotation<"good" | "bad">({
    reducer: (x, y) => y,
  }),
  finalInfoQuality: Annotation<"POSITIVE" | "NEGATIVE" | "UNCLEAR">({
    reducer: (x, y) => y,
  }),
});

const analyzeInitialPrompt = async (state: typeof AppState.State) => {
  console.log("Analizuję pierwsze zapytanie (z oceną jakości)...");

  const model = new ChatGoogleGenerativeAI({
    model: "gemini-1.5-flash-latest",
    temperature: 0.7,
  });

  const lastUserMessage = state.messages[state.messages.length - 1];

  const analysisPrompt = new HumanMessage(
    `You are a QA assistant. Your task is to assess the quality of the first bug report description from a user, which may include text and/or an image.
1.  Assess: Does the combination of text and image contain any meaningful information that could relate to a software problem? A screenshot alone is sufficient if it clearly shows a potential issue. Ignore greetings. Respond with a single word: 'GOOD' or 'BAD'.
2.  Summarize: If the assessment is 'GOOD', provide a brief summary of the problem based on all available information. If 'BAD', do not create a summary.

Format your response as follows:
Assessment: [GOOD or BAD]
Summary: [Your summary here, or leave empty if BAD]`
  );

  const response = await model.invoke([analysisPrompt, lastUserMessage]);
  const responseText = String(response.content);
  console.log("Odpowiedź analityczna modelu:", responseText);

  const assessmentMatch = responseText.match(/Assessment: (GOOD|BAD)/);
  const summaryMatch = responseText.match(/Summary: (.*)/);

  const quality =
    assessmentMatch && assessmentMatch[1] === "GOOD" ? "good" : "bad";
  const summary = summaryMatch ? summaryMatch[1].trim() : "";
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

  const model = new ChatGoogleGenerativeAI({
    model: "gemini-1.5-flash-latest",
    temperature: 0,
  });

  const systemPrompt = new HumanMessage(
    `You are a strict classifier. Answer with a single word YES if the following user reply is a refusal/decline (meaning they don't want or don't have what was requested). Answer NO otherwise.`
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

const triage_final_info_node = async (state: typeof AppState.State) => {
  console.log("Node: classifying intent of the final response.");
  const lastUserMessage = state.messages[state.messages.length - 1];
  const model = new ChatGoogleGenerativeAI({
    model: "gemini-1.5-flash-latest",
    temperature: 0,
  });

  const triagePrompt = new HumanMessage(
    `Jesteś klasyfikatorem intencji. Użytkownik odpowiedział na pytanie 'Czy chcesz dodać coś jeszcze?'. Przeanalizuj jego odpowiedź i zaklasyfikuj ją do jednej z trzech kategorii:

POSITIVE: Użytkownik dostarcza nowych, sensownych informacji (tekst lub obraz).
NEGATIVE: Użytkownik odmawia dodania informacji (np. 'nie', 'to wszystko', 'generuj raport').
UNCLEAR: Odpowiedź jest bez sensu, to losowe znaki, wulgaryzmy lub jest zbyt niejasna, by ją zrozumieć.

Odpowiedz tylko jednym słowem: POSITIVE, NEGATIVE, lub UNCLEAR.`
  );

  const response = await model.invoke([triagePrompt, lastUserMessage]);
  const classification = String(response.content).trim().toUpperCase() as
    | "POSITIVE"
    | "NEGATIVE"
    | "UNCLEAR";

  console.log("Classification result:", classification);

  return {
    finalInfoQuality: classification,
    waitingForAdditional: false,
  };
};

const finalinfo_clarification_node = async (state: typeof AppState.State) => {
  console.log("Node: asking for clarification of an unclear response.");

  const model = new ChatGoogleGenerativeAI({
    model: "gemini-1.5-flash-latest",
    temperature: 0.7,
  });

  const history = state.messages;

  const clarifyFinalInfoPrompt = new HumanMessage(
    `Jestes QA asystentem. Wygeneruj wiadomość, która zostanie wysłana do użytkownika. Odpowiedz po polsku, na to ze uzytkownik dostarczyl wiadomosc o niejasnym charakterze.`
  );

  const response = await model.invoke([...history, clarifyFinalInfoPrompt]);
  const responseText = String(response.content);

  const responseMessage = new AIMessage({ content: responseText });

  return {
    messages: [responseMessage],
    waitingForAdditional: true,
  };
};

const analyzeAdditionalInfoNode = async (state: typeof AppState.State) => {
  console.log("Węzeł: analizuję dodatkowe informacje (w tym obraz).");
  const model = new ChatGoogleGenerativeAI({
    model: "gemini-1.5-flash-latest",
    temperature: 0,
  });

  const lastUserMessage = state.messages[state.messages.length - 1];
  const analysisPrompt = new HumanMessage(
    "Przeanalizuj poniższą, dodatkową wiadomość (może zawierać tekst i/lub obraz) i streść zawarte w niej informacje w kontekście zgłoszenia błędu."
  );

  const response = await model.invoke([analysisPrompt, lastUserMessage]);
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
  const model = new ChatGoogleGenerativeAI({
    model: "gemini-1.5-flash-latest",
    temperature: 0.7,
  });

  const { initialDescription, imageProvided, imageAnalysis, additionalInfo } =
    state;

  const userImageMessages = state.messages.filter(messageHasImage);
  const imageCount = userImageMessages.length;

  const reportPrompt = `
    Jesteś doświadczonym analitykiem QA. Twoim zadaniem jest przekształcenie poniższych, luźnych notatek od użytkownika w profesjonalny, ustrukturyzowany raport błędu w formacie Markdown.
    
    **Twoje zadania:**
    1.  **Stwórz zwięzły, techniczny tytuł** na podstawie opisu problemu.
    2.  **Wypełnij sekcje raportu** na podstawie dostępnych danych.
    3.  Jeśli jakaś informacja nie została podana (np. URL, dokładne kroki), **zostaw w tym miejscu adnotację**, np. "[URL do uzupełnienia przez zespół]". Nie wymyślaj danych.
    4.  Dokonaj **krótkiej, technicznej analizy** problemu w sekcji "Dodatkowe informacje i analiza", bazując na wszystkich dostępnych informacjach (w tym analizie obrazu, jeśli istnieje).
    5.  Zachowaj DOKŁADNIE strukturę i formatowanie z poniższego szablonu. Zwróć szczególną uwagę, aby **przed i po każdej linii \`---\` znajdowała się pusta linia (enter)**. To kluczowe dla czytelności raportu.

    **Dane wejściowe od użytkownika:**
    -   **Początkowy opis:** ${initialDescription}
    -   **Analiza obrazu (jeśli jest):** ${imageAnalysis || "Brak"}
    -   **Dodatkowe informacje:** ${additionalInfo || "Brak"}

    **Szablon raportu do wypełnienia:**

    **Tytuł:** [Twój wygenerowany tytuł]

    ---

    **Środowisko:**
    -   **URL:** [URL do uzupełnienia przez zespół]
    -   **Przeglądarka:** [Do uzupełnienia na podstawie informacji od użytkownika, jeśli dostępne]
    -   **System operacyjny:** [Do uzupełnienia na podstawie informacji od użytkownika, jeśli dostępne]
    -   **Dodatkowe uwagi:** [Jeśli użytkownik podał, np. "Nie występuje w Firefox"]

    ---

    **Kroki do odtworzenia:**
    1.  [Krok 1 do uzupełnienia na podstawie opisu]
    2.  [Krok 2 do uzupełnienia na podstawie opisu]
    3.  ...

    ---

    **Oczekiwany rezultat:**
    [Opisz, jak powinno to działać, na podstawie opisu problemu]

    ---

    **Rzeczywisty rezultat:**
    [Opisz, co się faktycznie stało, na podstawie opisu problemu]

    ---

    **Dodatkowe informacje i analiza:**
    [Twoja techniczna analiza problemu]

    ---

    **Załączniki:**
    ${
      imageCount > 0
        ? `Liczba załączników: ${imageCount}. Znajdziesz je dołączone do tej wiadomości.`
        : "Brak załączników."
    }
    `;

  const response = await model.invoke([new HumanMessage(reportPrompt)]);
  const reportContent = String(response.content).trim();
  console.log("Wygenerowany raport:", reportContent);

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

  const model = new ChatGoogleGenerativeAI({
    model: "gemini-1.5-flash-latest",
    temperature: 0.7,
  });

  const history = state.messages;

  const answerBadQualityPrompt = new HumanMessage(
    `Jesteś asystentem AI. Twoim zadaniem jest grzeczne poinformowanie użytkownika, że jego ostatnia wiadomość jest niewystarczająca lub niezrozumiała do stworzenia raportu błędu. Poproś o więcej szczegółów. 
    Przeanalizuj historię rozmowy, aby zobaczyć, co już zostało powiedziane i sformułuj prośbę inaczej niż poprzednio.
    Odpowiedz krótko (maksymalnie 2 zdania), po polsku, w uprzejmym tonie.`
  );

  const response = await model.invoke([...history, answerBadQualityPrompt]);
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
