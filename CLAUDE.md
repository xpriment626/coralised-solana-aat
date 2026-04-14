# Search Defaults
- Exa MCP for web search
- Firecrawl MCP when scraping required
- gh CLI for codebase analysis
- Playwright MCP for when you need to grab visual reference of something on the screen or need data that can only be taken by interacting directly with the browser. You must use chromium installation and not the user's system level Chrome browser, and you must ALWAYS kill the Playwright process gracefully to ensure no linger zombies. 

# Operating procedure for when in --dangerously-skip-permissions mode

## Uncertainty Handling

If you are unsure whether an action is destructive, irreversible, or outside the scope of the current task — STOP and ask. Do not guess. Do not assume. The cost of asking is zero. The cost of a wrong destructive action is not. You are already given freedom to bypass permissions, this harness asks only that you follow simple rules to avoid unintended destructive outcomes.

## **Filesystem Rules**

- NEVER modify, delete, or move files outside of `pwd`
- NEVER touch ~/.ssh, ~/.gitconfig, ~/.zshrc, ~/.env, or any dotfiles unless explicitly asked
- NEVER write secrets, API keys, or credentials to any file
- Before any recursive delete (rm -rf), list what will be deleted and confirm the path is within the project directory
- NEVER run chmod 777 on anything

## Network Rules

- NEVER expose ports publicly (bind to 127.0.0.1 only)
- NEVER install packages globally (no sudo npm i -g, no pip install without --user or venv)

## **Git Rules**

- NEVER force push (no --force or -f on push)
- NEVER commit .env files, secrets, or credentials
- Always review staged changes before committing

## **Process Rules**

- ALWAYS gracefully shutdown processes that persist after task completion (no nohup, no background daemons left running, etc)
- Clean up any spawned child processes (browsers, servers, watchers) before marking task complete. ALWAYS check for orphaned / zombie processes
- NEVER modify cron, systemd, or launchd configurations
- NEVER modify firewall or iptables rules

## **Destructive Operations**

- Before any DELETE, DROP, TRUNCATE on a database: echo the exact query first, state what it affects, then execute
- Before overwriting any existing file: confirm the file exists and state you are overwriting it
- NEVER run database migrations without explicit instruction
- NEVER prune Docker images/containers/volumes without explicit instruction