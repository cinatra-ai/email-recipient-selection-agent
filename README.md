# Email Recipient Selection Agent

Resolves one or more saved CRM contacts lists into the confirmed recipient pool for an email campaign. At runtime, the agent prompts you to pick one or more CRM lists, re-fetches their members from source and counts each contact once, enforces a `maxRecipients` cap (default 200) on the ticked lists' total, saves the recipient list and hands on its reference, and presents the resolved contact rows for your review and approval before drafting begins.

**Install:** add the agent from the marketplace within an email outreach workflow. Set the `maxRecipients` cap in the agent install settings panel. No API keys are required beyond your existing CRM connection.

**Usage:** the agent is triggered by an email campaign run. It first reads the lists you can pick from in Twenty CRM (`crm_list_search` for contact lists) and shows them, in the order the CRM answers them, in an interactive picker. If Twenty CRM has no list yet, the step asks you to create one there. After you pick, the agent runs autonomously: fetches each list's metadata, joins the members so a contact on several lists is counted once, expands each contact, saves the recipient list, then holds the run at its own "Review recipients" step, where you confirm or remove recipients before the selection is finalized. If the ticked lists together hold more contacts than `maxRecipients`, the agent blocks and reports an error rather than silently truncating. A cooldown filter (keeping out recently-contacted recipients) is applied at that review step; you can toggle it to include them.

**Troubleshooting:** if you see `unsupported_account_scope`, select one or more saved CRM lists (not "all contacts"). If a list returns zero members, the list may be empty or stale. If the run blocks with a cap error, tick fewer or smaller lists or raise `maxRecipients` in settings.

## Works with

- Cinatra email outreach workflows

## Capabilities

- List every contact list in Twenty CRM for you to pick from
- Resolve one or more saved CRM lists into a confirmed recipient pool, re-fetching live data at run time
- Enforce a configurable maximum-recipients cap on the ticked lists' total and block the run if it is exceeded
- Expand each contact to include name, title, email, and parent account name
- Skip stale list references without aborting the run
- Present the final recipient set for human review and approval before drafting begins
