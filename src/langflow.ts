import { LangflowClient } from '@datastax/langflow-client';
import { llm } from '@livekit/agents';
import { randomUUID } from 'node:crypto';

export type Tweak = Record<string, string | number | null | boolean>;
export type Tweaks = Record<string, Tweak | string>;

export type LangflowOptions = {
  langflowId: string; // it is required if you are using langflow cloud
  baseUrl: string; // it is required if you are using langflow self-hosted
  apiKey: string | undefined;
  flowId: string;
  sessionId: string; // it's optional, but if it's not set, the session will be created automatically
  tweaks: Tweaks;
};

const defaultLangflowOptions: Partial<LangflowOptions> = {
  apiKey: process.env.LANGFLOW_API_KEY,
  baseUrl: process.env.LANGFLOW_BASE_URL,
};

export class LLM extends llm.LLM {
  #opts: Partial<LangflowOptions>;
  #client: LangflowClient;

  constructor(opts: Partial<LangflowOptions>) {
    super();
    this.#opts = { ...defaultLangflowOptions, ...opts };

    if (!this.#opts.langflowId && !this.#opts.baseUrl) {
      throw new Error('langflowId or baseUrl must be set');
    }
    if (!this.#opts.apiKey) {
      throw new Error('LANGFLOW_API_KEY is not set');
    }

    if (!this.#opts.flowId) {
      throw new Error('flowId is not set');
    }

    if (!this.#opts.sessionId) {
      this.#opts.sessionId = randomUUID();
    }

    if (this.#opts.langflowId) {
      // langflow cloud
      this.#client = new LangflowClient({
        langflowId: this.#opts.langflowId,
        apiKey: this.#opts.apiKey,
      });
    } else {
      // langflow self-hosted
      this.#client = new LangflowClient({
        baseUrl: this.#opts.baseUrl,
        apiKey: this.#opts.apiKey,
      });
    }
  }

  chat({
    chatCtx,
    fncCtx,
  }: {
    chatCtx: llm.ChatContext;
    fncCtx?: llm.FunctionContext;
  }): llm.LLMStream {
    return new LLMStream(this, this.#client, chatCtx, fncCtx, this.#opts);
  }
}

export class LLMStream extends llm.LLMStream {
  #client: LangflowClient;
  label: string = 'langflow.LLMStream';

  constructor(
    llm: LLM,
    client: LangflowClient,
    chatCtx: llm.ChatContext,
    fncCtx: llm.FunctionContext | undefined,
    opts: Partial<LangflowOptions>,
  ) {
    super(llm, chatCtx, fncCtx);
    this.#client = client;
    this.#run(opts);
  }

  async #run(opts: Partial<LangflowOptions>): Promise<void> {
    try {
      const chatToSend = this.chatCtx.messages.pop()!.content!.toString();
      console.info('Sending chat to Langflow', chatToSend);
      const startTime = Date.now();
      const flowResponse = await this.#client.flow(opts.flowId!).run(chatToSend, {
        session_id: opts.sessionId,
        tweaks: opts.tweaks,
      });
      const chat = flowResponse.chatOutputText();
      const endTime = Date.now();
      console.info(`Langflow response received in ${endTime - startTime}ms`);

      this.queue.put({
        requestId: '1',
        choices: [
          {
            delta: { content: chat, role: llm.ChatRole.ASSISTANT },
            index: 0,
          },
        ],
      });
    } finally {
      this.queue.close();
    }
  }
}
