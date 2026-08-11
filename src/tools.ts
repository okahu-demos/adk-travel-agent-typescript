import { FunctionTool } from '@google/adk';
import { z } from 'zod/v4';

export const bookFlightTool = new FunctionTool({
  name: 'adk_book_flight',
  description: 'Books a flight between two airports.',
  parameters: z.object({
    from_airport: z.string().describe('The departure airport code (e.g., SFO)'),
    to_airport: z.string().describe('The destination airport code (e.g., BOM)'),
  }),
  execute: async ({ from_airport, to_airport }) => {
    return {
      status: 'success',
      message: `Flight booked from ${from_airport} to ${to_airport}.`,
    };
  },
});

export const bookHotelTool = new FunctionTool({
  name: 'adk_book_hotel',
  description: 'Books a hotel stay at the specified hotel in a given city.',
  parameters: z.object({
    hotel_name: z.string().describe('The name of the hotel (e.g., Marriott Intercontinental)'),
    city: z.string().describe('The city where the hotel is located (e.g., Mumbai)'),
  }),
  execute: async ({ hotel_name, city }) => {
    return {
      status: 'success',
      message: `Successfully booked a stay at ${hotel_name} in ${city}.`,
    };
  },
});
