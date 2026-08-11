/* eslint-disable @typescript-eslint/no-var-requires */
require('dotenv/config');
const { setupMonocle } = require('monocle2ai');

// require() runs inline (not hoisted), so calling setupMonocle() here patches
// ADK BEFORE the requires below pull it in. No async wrapper needed.
setupMonocle('adk-travel-agent-ts');

const { rootAgent } = require('./agents-orchestrator.js');
const { runCliWithSession } = require('./runner.js');

runCliWithSession(rootAgent);

export {};
