"""OAuth 2.1 authorization server, so a user can authorize an AI assistant.

The app is both the authorization server and the resource server: /oauth/*
issues the tokens, /mcp accepts them. That is the shape the MCP authorization
spec expects (MCP server as OAuth 2.1 resource server), and it is what lets a
user connect ChatGPT or Claude with a normal sign-in instead of a pasted
credential.

Nothing here is Epic-specific except the scope list in scopes.py.
"""
