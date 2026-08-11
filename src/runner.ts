/* eslint-disable @typescript-eslint/no-var-requires */
const { InMemoryRunner, isFinalResponse, stringifyContent } = require('@google/adk');
const { createInterface } = require('readline');
const { randomUUID } = require('crypto');

const APP_NAME = 'adk_travel_agent';
const USER_ID = 'user_123';

async function runAgent(rootAgent: unknown, userRequest: string): Promise<void> {
  const runner = new InMemoryRunner({
    agent: rootAgent,
    appName: 'adk_travel_agent',
  });

  const events = runner.runEphemeral({
    userId: 'user_123',
    newMessage: {
      role: 'user',
      parts: [{ text: userRequest }],
    },
  });

  let lastResponse = '';
  for await (const event of events) {
    if (isFinalResponse(event)) {
      const response = stringifyContent(event);
      if (response.trim()) lastResponse = response;
    }
  }
  if (lastResponse) console.log('\nTravel Agent:', lastResponse);
}

// Shared CLI entry point. Each agent module's entry file passes in its own
// rootAgent so the two orchestration approaches stay fully separate.
export async function runCli(rootAgent: unknown): Promise<void> {
  const query = process.argv[2];

  if (query) {
    await runAgent(rootAgent, query);
  } else {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    rl.question(
      '\nI am a travel booking agent. How can I assist you with your travel plans? ',
      async (userRequest: string) => {
        rl.close();
        await runAgent(rootAgent, userRequest);
      },
    );
  }
}

// Session-managed run, mirroring the Python adk-travel-agent: an explicit
// session is created in the (in-memory) session service, then runAsync replays
// that session's history to the agent. No startTrace wrapper, so Monocle emits
// one trace per runAsync call (one trace per turn).
async function runAgentWithSession(
  runner: any,
  sessionId: string,
  userRequest: string,
): Promise<void> {
  const events = runner.runAsync({
    userId: USER_ID,
    sessionId,
    newMessage: {
      role: 'user',
      parts: [{ text: userRequest }],
    },
  });

  let lastResponse = '';
  for await (const event of events) {
    if (isFinalResponse(event)) {
      const response = stringifyContent(event);
      if (response.trim()) lastResponse = response;
    }
  }
  if (lastResponse) console.log('\nTravel Agent:', lastResponse);
}

// Python-style CLI entry point: build the runner once, create a managed session,
// then run via runAsync against that session id. Interactive mode loops so the
// conversation is multi-turn — the same session id is reused every turn, so the
// agent keeps full context across turns (each runAsync is still its own trace).
export async function runCliWithSession(rootAgent: unknown): Promise<void> {
  const runner = new InMemoryRunner({ agent: rootAgent, appName: APP_NAME });
  const sessionId = randomUUID();
  await runner.sessionService.createSession({
    appName: APP_NAME,
    userId: USER_ID,
    sessionId,
  });

  // One-shot mode: a request passed as a CLI argument runs a single turn.
  const query = process.argv[2];
  if (query) {
    await runAgentWithSession(runner, sessionId, query);
    return;
  }

  // Interactive multi-turn mode: keep prompting until the user exits. Consuming
  // the readline interface as an async iterator buffers any input that arrives
  // while a turn is being processed and ends cleanly on EOF / Ctrl-D.
  const rl = createInterface({ input: process.stdin, output: process.stdout });

  console.log('\nI am a travel booking agent. How can I assist you with your travel plans?');
  console.log("(Type 'exit' or 'quit' to end the conversation.)");
  process.stdout.write('\nYou: ');

  for await (const line of rl) {
    const userRequest = line.trim();
    if (['exit', 'quit'].includes(userRequest.toLowerCase())) break;
    if (userRequest) {
      await runAgentWithSession(runner, sessionId, userRequest);
    }
    process.stdout.write('\nYou: ');
  }

  rl.close();
}
