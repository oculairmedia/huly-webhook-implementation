import { tool } from "@opencode-ai/plugin"

const z = tool.schema

export const test_tool = tool({
  description: "Simple test tool",
  args: {
    message: z.string().describe("Test message")
  },
  async execute(args, context) {
    return JSON.stringify({ received: args.message })
  }
})
