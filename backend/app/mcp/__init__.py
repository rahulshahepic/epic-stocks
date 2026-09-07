"""The MCP server — what an AI assistant actually talks to.

Phase 1 ships the transport and the authorization boundary; the tool registry
in tools.py is empty until Phase 2 fills it. A connector added to ChatGPT or
Claude today will connect, authenticate and report no tools.
"""
