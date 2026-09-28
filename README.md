# Email Recipient Selection Agent

Resolves one or more saved CRM contacts lists into the confirmed recipient pool for an email campaign. Install this agent from the Cinatra marketplace as part of an email outreach workflow. At runtime, the agent prompts you to pick one or more CRM lists, re-fetches their members from source and counts each contact once, enforces a `maxRecipients` cap (default 200 — override in agent install settings) on the ticked lists' total, saves the recipient list and hands on its reference, and presents the resolved contact rows for your review and approval before the drafting stage begins.

**Install:** add the agent from the marketplace and configure it within an email outreach workflow. The `maxRecipients` cap is set in the agent install settings panel. No API keys are required beyond your existing CRM connection.

**Usage:** the agent is triggered by an email campaign run. It collects your list selection via an interactive picker, then runs autonomously: fetches each list's metadata, joins the members so a contact on several lists is counted once, expands each contact (name, title, email, account), resolves parent account names, saves the recipient list, and then holds the run at its own "Review recipients" step, where you confirm or remove recipients before the reviewed selection is finalized. If the contact count of the ticked lists together exceeds `maxRecipients`, the agent blocks and reports an error rather than silently truncating. A cooldown filter (preventing recently-contacted recipients from being re-included) is applied at that review step, and you can toggle it to include the filtered recipients.

**Troubleshooting:** if the agent returns `unsupported_account_scope`, select one or more saved CRM lists (not "all contacts"). If a list returns zero members, the list may be empty or stale. If the run blocks with a cap error, tick fewer or smaller lists or raise `maxRecipients` in settings.

## Works with

- Cinatra email outreach workflows

## Capabilities

- Resolve one or more saved CRM lists into a confirmed recipient pool, re-fetching live data at run time
- Enforce a configurable maximum-recipients cap on the ticked lists' total and block the run if it is exceeded
- Expand each contact to include name, title, email, and parent account name
- Skip stale list references without aborting the run
- Present the final recipient set for human review and approval before drafting begins
