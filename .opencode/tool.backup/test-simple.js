import { tool } from "@opencode-ai/plugin"

export default tool({
  description: "Ultra simple test",
  args: {
    msg: tool.schema.string()
  },
  async execute(args) {
    return "test result: " + args.msg
  }
})
