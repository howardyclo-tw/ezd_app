# EZD App - Development Guide & MCP Tips

Welcome to the EZD App development repository. This guide covers project-specific developer tips, with a focus on leveraging the **Supabase MCP (Model Context Protocol)** for efficient development.

## 🚀 Supabase MCP Tips for Developers

Using the Supabase MCP server allows AI assistants (like Antigravity) to interact directly with your database, logs, and edge functions. This provides a much tighter feedback loop compared to manually checking the Supabase dashboard.

### 1. Project Information
- **Project Name**: `ezd-app`
- **Project ID**: `zhaloqbeguzsknodrxsm`
- **Region**: `ap-northeast-1`

### 2. Common MCP Tasks
You can ask your AI assistant to perform the following tasks directly:

- **Schema Inspection**: "List all tables in the public schema" or "Show me the columns for the `profiles` table."
- **Data Querying**: "Query the latest 5 course sessions" or "Find the user with email 'test@example.com' in the profiles table."
- **Health Checks**: "Check the health and status of my Supabase project."
- **Log Review**: "Show me the last 10 logs for the `api` service to help debug this 500 error."
- **Advisory**: "Run the security advisor and tell me if any tables are missing RLS policies."

### 3. Why Use MCP?
- **Context-Aware Coding**: The AI can see your actual schema while writing queries or types, reducing "hallucinations."
- **Faster Debugging**: Instantly retrieve logs or record counts without leaving your editor.
- **Data Verification**: Quickly verify if your latest feature correctly inserted data into the database.

---

## 🛠 Project Structure
- `/src`: Application source code (Next.js + Tailwind)
- `/supabase`: Local Supabase configuration, migrations, and seed data.
- `/docs`: Project documentation (`prd.md`, `system-overview.md`).

## 📜 Documentation Links
- [Product Requirements Document (PRD)](./prd.md)
- [System Overview](./system-overview.md)
