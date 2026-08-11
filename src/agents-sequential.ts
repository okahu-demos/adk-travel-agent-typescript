import { LlmAgent, SequentialAgent } from '@google/adk';
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
    'You produce the single final message shown to the user. Base it on what the flight and hotel ' +
    'booking agents did earlier in this conversation (their outputs are provided to you as context). ' +
    'If the requested bookings are complete, give a concise one-sentence summary of them. ' +
    'If a booking agent needs more information or asked the user a question (e.g. missing airport ' +
    'codes or hotel/city), relay that request to the user clearly and concisely so they know exactly ' +
    'what to provide next. Never reply that you "cannot summarize" — always convey the most useful ' +
    'core message, whether that is the booking summary or the pending question.',
  tools: [],
  outputKey: 'booking_summary',
  generateContentConfig: {
    maxOutputTokens: MAX_OUTPUT_TOKENS,
  },
});

// Sequential approach: the sub-agents always run in a fixed order
// (flight → hotel → summary), with no LLM orchestrator deciding the flow.
export const rootAgent = new SequentialAgent({
  name: 'adk_supervisor_agent',
  description:
    'Supervisor agent that coordinates flight booking, hotel booking, and a trip summary by ' +
    'running the booking agents in sequence.',
  subAgents: [flightBookingAgent, hotelBookingAgent, tripSummaryAgent],
});
