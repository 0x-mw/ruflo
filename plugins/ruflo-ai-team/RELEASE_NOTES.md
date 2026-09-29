# 0.1.0 — Initial review candidate

- New multi-tenant RuFlo AI Team MCP service, separate from RuFlo Federation.
- Twelve focused tools for templates, teams, runs, tasks, tenant-local memory, and evidence.
- OAuth 2.1 resource-server discovery with strict issuer, audience, scope, and tenant binding.
- Firestore canonical storage plus bounded per-tenant/team RuVector derived indexes.
- Six workflow skills, four specialized agents, four commands, two MCP prompts, and one template resource.
- Complete explicit tool annotations, secret-free schemas, cross-tenant denial tests, untrusted-content fencing, legal pages, Docker packaging, and Cloud Run manifest.

Known boundary: v0.1 coordinates and verifies work but does not dispatch paid models, provision desktops, execute arbitrary commands, send messages, deploy, purchase, publicly share, or delete tenant data.
