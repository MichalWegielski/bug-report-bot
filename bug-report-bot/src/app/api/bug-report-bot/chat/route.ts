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
});

const analyzeInitialPrompt = async (state: typeof AppState.State) => {
  console.log("Analizuję pierwsze zapytanie (z oceną jakości)...");

  const model = new ChatGoogleGenerativeAI({
    model: "gemini-1.5-flash-latest",
    temperature: 0,
  });

  const lastUserMessage = state.messages[state.messages.length - 1];

  const analysisPrompt = new HumanMessage(
    `You are a QA assistant. Your task is to assess the quality of the first bug report description from a user.
1.  Assess: Does the description contain any meaningful information that could relate to a software problem? Ignore greetings. Respond with a single word: 'GOOD' or 'BAD'.
2.  Summarize: If the assessment is 'GOOD', provide a brief summary of the problem. If 'BAD', do not create a summary.

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
    waitingForAdditional: false,
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
    temperature: 0,
  });

  const { initialDescription, imageProvided, imageAnalysis, additionalInfo } =
    state;

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
    ${imageProvided ? "{{IMAGE_PLACEHOLDER}}" : "Brak załączników."}
    `;

  const response = await model.invoke([new HumanMessage(reportPrompt)]);
  const reportContent = String(response.content).trim();
  console.log("Wygenerowany raport:", reportContent);

  const userImageMessage = state.messages.find(messageHasImage);
  let imageUrl: string | undefined;

  if (userImageMessage && Array.isArray(userImageMessage.content)) {
    const imagePart = userImageMessage.content.find(
      (part) => (part as any).type === "image_url"
    ) as any;
    if (imagePart?.image_url?.url) {
      imageUrl = imagePart.image_url.url;
    }
  }

  const reportMessageContent: any = [{ type: "text", text: reportContent }];
  if (imageUrl) {
    reportMessageContent.push({
      type: "image_url",
      image_url: { url: imageUrl },
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
    temperature: 0,
  });

  const answerBadQualityPrompt = new HumanMessage(
    `Odpowiedz tutaj grzecznie, na to ze nie podane informacje sa nie wystraczające lub niezrozumiałe. 
    Poproś o opisanie problemu jeszcze raz, podając więcej szczegółów. Odpowiedz w max 2 zdaniach i z kazdą nastepną wiadomością innymi słowami.
    Odpowiedz w stylu "Przepraszam, nie zrozumiałem. Możesz opisać problem jeszcze raz? Dane które podałeś nie są wystarczające, lub nie zrozumiałe"
    Odpowiedz tak ale swoimi slowami.
    `
  );

  const response = await model.invoke([answerBadQualityPrompt]);
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
  .addConditionalEdges("handle_final_info", (state) => {
    if (state.additionalDeclined) {
      return "generate_report";
    }
    return "analyze_additional_info";
  })
  .addConditionalEdges("reprompt_node", masterRouter)
  .addEdge("analyze_additional_info", "generate_report")
  .addEdge("generate_report", END)
  .compile({
    interruptAfter: [
      "ask_for_screenshot",
      "ask_for_final_info",
      "reprompt_node",
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
