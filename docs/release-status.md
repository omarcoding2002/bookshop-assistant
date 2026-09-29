# Release status

Updated 30 September 2026.

| Deliverable                             | Status                                                                                       |
| --------------------------------------- | -------------------------------------------------------------------------------------------- |
| Working local application               | Implemented; `npm run build && npm start`                                                    |
| Real book metadata                      | 97 Open Library editions with provenance                                                     |
| Conversational AI integration           | Implemented; provider boundary tested with mocks; funded live test pending                   |
| Offline demonstration                   | Working and visibly labelled; 20/20 scenario checks passed                                   |
| Commerce and API tests                  | 32/32 passed, including restart persistence and concurrent confirmations                     |
| Desktop/mobile browser tests            | 8/8 passed                                                                                   |
| Responsive UI                           | Implemented directly; Claude Code CLI was unavailable                                        |
| Requirements/architecture/API docs      | Included                                                                                     |
| GitHub destination                      | Existing empty public repository found: https://github.com/omarcoding2002/bookshop-assistant |
| Public Render demo                      | Not deployed; account authorization/database/model setup pending                             |
| Dependency audit                        | Zero known vulnerabilities reported after patch updates                                      |
| Live quality and performance acceptance | Pending funded model access; not represented by offline tests                                |

## Account actions needed to finish publication

- Provide Git push access to the existing repository if the system keychain has no valid credential.
- Complete/approve Render’s GitHub authorization and repository connection. The browser reached an authorization page requesting identity verification, knowledge of accessible resources, acting on the account’s behalf and read access to email addresses; it was not approved automatically.
- Provide a Neon `DATABASE_URL` and an Anthropic `ANTHROPIC_API_KEY` through the local environment/Render secrets, with a dedicated $10 capped workspace.
- If Claude Code specifically must perform the UI phase, install/authenticate it; the existing UI and handoff are ready.

Once those are available, push the prepared code, apply the Render blueprint, run live evaluation and the public purchase smoke test, then record the confirmed public URL here. No public-demo URL should be invented from the intended service name.
