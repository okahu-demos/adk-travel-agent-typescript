import { AgentTool, LlmAgent } from '@google/adk';
import { bookFlightTool, bookHotelTool } from './tools.js';

const MODEL = process.env.GOOGLE_GENAI_MODEL ?? 'gemini-2.5-flash-lite';
const MAX_OUTPUT_TOKENS = parseInt(process.env.MAX_OUTPUT_TOKENS ?? '1000', 10);

const flightBookingAgent = new LlmAgent({
  name: 'adk_flight_booking_agent',
  model: MODEL,
  description: 'Agent to book flights based on user queries.',
  instruction:
    'You are a helpful agent who can assist users in booking flights. ' +
    'You only handle flight booking. Just handle that part from what the user says, ignore other parts of the requests.',
  tools: [bookFlightTool],
  generateContentConfig: {
    maxOutputTokens: MAX_OUTPUT_TOKENS,
  },
});

const hotelBookingAgent = new LlmAgent({
  name: 'adk_hotel_booking_agent',
  model: MODEL,
  description: 'Agent to book hotels based on user queries.',
  instruction:
    'You are a helpful agent who can assist users in booking hotels. ' +
    'You only handle hotel booking. Book hotel if the user explicitly asks, just handle that part from what the user says, ignore other parts of the requests. ' +
    'NOTE: Marriott is only available on odd dates. Otherwise Hilton is the primary option unless user states specific hotel criteria and you can go ahead and book that instead.',
  tools: [bookHotelTool],
  generateContentConfig: {
    maxOutputTokens: MAX_OUTPUT_TOKENS,
  },
});

const tripSummaryAgent = new LlmAgent({
  name: 'adk_trip_summary_agent',
  model: MODEL,
  description: 'Summarize the travel details from hotel bookings and flight bookings agents.',
  instruction:
    'Summarize the travel details from hotel bookings and flight bookings agents. Be concise in response and provide a single sentence summary.',
  tools: [],
  outputKey: 'booking_summary',
  generateContentConfig: {
    maxOutputTokens: MAX_OUTPUT_TOKENS,
  },
});

// LLM-as-orchestrator approach: a supervisor LlmAgent decides which sub-agent
// (exposed as a tool) to invoke, and in what order, based on the user request.
export const rootAgent = new LlmAgent({
  name: 'adk_supervisor_agent',
  model: MODEL,
  description:
    'Supervisor agent that coordinates flight and hotel bookings and provides a trip summary.',
  instruction:
    'You are a travel booking assistant. You coordinate flight and hotel bookings for users. ' +
    'Use the adk_flight_booking_agent tool to book flights and the adk_hotel_booking_agent tool to book hotels. ' +
    'Before calling any booking tool, make sure you have all required details — ask the user for anything that is missing. ' +
    'For flights you need: departure airport code and destination airport code. ' +
    'For hotels you need: hotel name and city. ' +
    'Once all requested bookings are complete, call the adk_trip_summary_agent tool to produce a final summary.',
  tools: [
    new AgentTool({ agent: flightBookingAgent }),
    new AgentTool({ agent: hotelBookingAgent }),
    new AgentTool({ agent: tripSummaryAgent }),
  ],
  generateContentConfig: {
    maxOutputTokens: MAX_OUTPUT_TOKENS,
  },
});
