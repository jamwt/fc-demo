import { v } from "convex/values";
import {
  internalMutation,
  internalAction,
  internalQuery,
} from "./_generated/server";
import { internal } from "./_generated/api";
import { Id } from "./_generated/dataModel";
import OpenAI from "openai";

type SampleSet = {
  dialogues: Dialogue[];
};

type Dialogue = {
  prompt: string;
  response: string;
};

export const createSampleResponses = internalAction({
  args: {},
  handler: async (ctx) => {
    // You can make this an argument in the future.
    const fileId = "kg2e8z2syjhdbpyzxgw68resk57f2607" as Id<"_storage">;

    const blob = await ctx.storage.get(fileId);
    if (!blob) {
      throw new Error("File not found");
    }

    const text = await blob.text();
    const json = JSON.parse(text) as SampleSet;

    for (const dialogue of json.dialogues) {
      const oai = new OpenAI();

      const embeddingResponse = await oai.embeddings.create({
        model: "text-embedding-3-small",
        input: dialogue.prompt,
      });
      const embedding = embeddingResponse.data[0].embedding;

      await ctx.runMutation(internal.myFunctions.createEmbedding, {
        prompt: dialogue.prompt,
        response: dialogue.response,
        embedding,
      });
    }
  },
});

export const createEmbedding = internalMutation({
  args: {
    prompt: v.string(),
    response: v.string(),
    embedding: v.array(v.float64()),
  },
  handler: async (ctx, args) => {
    await ctx.db.insert("sampleResponses", {
      prompt: args.prompt,
      response: args.response,
      embedding: args.embedding,
    });
  },
});

type SearchResult = {
  prompt: string;
  response: string;
};

export const findSimilarResponses = internalAction({
  args: {
    prompt: v.string(),
  },
  returns: v.array(
    v.object({
      prompt: v.string(),
      response: v.string(),
    })
  ),
  handler: async (ctx, args): Promise<Array<SearchResult>> => {
    const oai = new OpenAI();

    // Generate embedding for the input prompt
    const embeddingResponse = await oai.embeddings.create({
      model: "text-embedding-3-small",
      input: args.prompt,
    });
    const promptEmbedding = embeddingResponse.data[0].embedding;

    // Search for similar responses using vector search
    const results = await ctx.vectorSearch("sampleResponses", "by_embedding", {
      vector: promptEmbedding,
      limit: 5,
    });

    // Fetch the full documents for the results
    const docs: Array<SearchResult> = await ctx.runQuery(
      internal.myFunctions.fetchResults,
      {
        ids: results.map((result) => result._id),
      }
    );

    return docs;
  },
});

export const fetchResults = internalQuery({
  args: {
    ids: v.array(v.id("sampleResponses")),
  },
  returns: v.array(
    v.object({
      prompt: v.string(),
      response: v.string(),
    })
  ),
  handler: async (ctx, args) => {
    const results: Array<SearchResult> = [];
    for (const id of args.ids) {
      const doc = await ctx.db.get(id);
      if (doc === null) continue;
      results.push({
        prompt: doc.prompt,
        response: doc.response,
      });
    }
    return results;
  },
});

interface Message {
  role: "system" | "user" | "assistant";
  content: string;
}

export const chat = internalAction({
  args: {
    prompt: v.string(),
  },
  handler: async (ctx, args) => {
    const priors = await ctx.runAction(
      internal.myFunctions.findSimilarResponses,
      {
        prompt: args.prompt,
      }
    );

    const oai = new OpenAI();

    const systemMessage = `You will be shown examples of a dialogue including a prompt and a response by a particular
       character. Follow the mannerisms of the character in these examples when responding to new inputs.
       keep your answers concise and to the point.
       
       Do not use any proper names in your response.`;

    const messages: Message[] = [{ role: "system", content: systemMessage }];

    // Add examples
    for (const example of priors) {
      messages.push({ role: "user", content: example.prompt });
      messages.push({ role: "assistant", content: example.response });
    }

    // Add the new query
    messages.push({ role: "user", content: args.prompt });

    const response = await oai.chat.completions.create({
      model: "gpt-4.1-mini",
      messages: messages,
    });


    return response.choices[0].message.content;
  },
});
