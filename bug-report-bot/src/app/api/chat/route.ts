import { NextResponse } from "next/server";
import {
  StateGraph,
  MessagesAnnotation,
  START,
  END,
} from "@langchain/langgraph";
import { ChatOpenAI } from "@langchain/openai";

const callModel = async (state: typeof MessagesAnnotation.State) => {
  const model = new ChatOpenAI({ model: "gpt-4o", temperature: 0 });
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
  return NextResponse.json(result);
}
