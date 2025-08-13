import { NextResponse } from "next/server";
import {
  StateGraph,
  MessagesAnnotation,
  START,
  END,
} from "@langchain/langgraph";
import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { BaseMessage, HumanMessage } from "@langchain/core/messages";

const callModel = async (state: typeof MessagesAnnotation.State) => {
  const model = new ChatGoogleGenerativeAI({
    model: "gemini-1.5-flash-latest",
    temperature: 0,
  });
  const response = await model.invoke(state.messages);
  return { messages: [response] };
};

const app = new StateGraph(MessagesAnnotation)
  .addNode("agent", callModel)
  .addEdge(START, "agent")
  .addEdge("agent", END)
  .compile();

export async function POST(req: Request) {
  const body = await req.json();
  const messages = body.messages ?? [];
  const result = await app.invoke({ messages });
  const formattedResult = {
    messages: result.messages.map((msg: BaseMessage) => ({
      role: msg instanceof HumanMessage ? "user" : "assistant",
      content: msg.content,
    })),
  };

  return NextResponse.json(formattedResult);
}
