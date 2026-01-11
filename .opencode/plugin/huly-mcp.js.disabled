export const HulyMcpHelper = async ({ project, client, $, directory, worktree }) => {
  console.log("HulyMcpHelper plugin loaded for:", directory)

  return {
    // Adds a convenience event log on idle so users see it's alive
    event: async (payload) => {
      const evt = payload?.event ?? payload
      if (evt?.type === "session.idle") {
        console.log("[HulyMcpHelper] Session idle - remember you can use tools mcp_* to interact with the MCP server.")
      }
    },

    // Before executing built-in read tool, lightly warn on .env reads (do not block)
    "tool.execute.before": async (input, output) => {
      const toolName = typeof input === "string" ? input : input?.tool
      const filePath =
        typeof output?.args?.filePath === "string"
          ? output.args.filePath
          : typeof input?.args?.filePath === "string"
            ? input.args.filePath
            : undefined

      if (toolName === "read" && typeof filePath === "string" && filePath.includes(".env")) {
        console.warn("[HulyMcpHelper] Warning: Reading .env files may expose secrets. Proceed with caution.")
      }
    },
  }
}
