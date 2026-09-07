/* eslint-disable @typescript-eslint/no-var-requires */
require('dotenv/config');

const { rootAgent } = require('./agents-orchestrator.js');
const { runCliWithSession } = require('./runner.js');

runCliWithSession(rootAgent);

export {};
