/* eslint-disable @typescript-eslint/no-var-requires */
require('dotenv/config');

const { rootAgent } = require('./agents-sequential.js');
const { runCliWithSession } = require('./runner.js');

runCliWithSession(rootAgent);
