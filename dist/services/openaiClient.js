"use strict";
// This is a mock OpenAI client setup for development purposes.
// In a real production environment, you would use the official 'openai' package
// and configure it with your API key from environment variables.
Object.defineProperty(exports, "__esModule", { value: true });
exports.openai = void 0;
exports.openai = {
    chat: {
        completions: {
            create: async (options) => {
                console.log('[MOCK OpenAI] Generating chat completion with options:', options);
                // Simulate a delay
                await new Promise(resolve => setTimeout(resolve, 500));
                // Return a mock response. For the match score, we need a number.
                return {
                    choices: [
                        {
                            message: {
                                content: `${Math.floor(Math.random() * 30) + 65}`, // Return a random score between 65 and 95
                            },
                        },
                    ],
                };
            },
        },
    },
};
