# Email Recipient Selection Agent

Resolves a saved CRM contacts list into the confirmed recipient pool for an email campaign. Install this agent from the Cinatra marketplace as part of an email outreach workflow. At runtime, the agent prompts you to pick a CRM list, re-fetches its members from source, enforces a `maxRecipients` cap (default 200 — override in agent install settings), and presents the resolved contact rows for your review and approval before the drafting stage begins.

**Install:** add the agent from the marketplace and configure it within an email outreach workflow. The `maxRecipients` cap is set in the agent install settings panel. No API keys are required beyond your existing CRM connection.

**Usage:** the agent is triggered by an email campaign run. It collects your list selection via an interactive picker, then runs autonomously: fetches list metadata, expands each contact (name, title, email, account), resolves parent account names, and then holds the run at its own "Review and approve" step, where you confirm or remove recipients before the reviewed selection is finalized. If the contact count exceeds `maxRecipients`, the agent blocks and reports an error rather than silently truncating. A cooldown filter (preventing recently-contacted recipients from being re-included) is applied at that review step, and you can toggle it to include the filtered recipients.

**Troubleshooting:** if the agent returns `unsupported_account_scope`, select a saved CRM list (not "all contacts"). If a list returns zero members, the list may be empty or stale. If the run blocks with a cap error, reduce the list size or raise `maxRecipients` in settings.

## Works with

- Cinatra email outreach workflows

## Capabilities

- Resolve a saved CRM list into a confirmed recipient pool, re-fetching live data at run time
- Enforce a configurable maximum-recipients cap and block the run if the list exceeds it
- Expand each contact to include name, title, email, and parent account name
- Skip stale list references without aborting the run
- Present the final recipient set for human review and approval before drafting begins
