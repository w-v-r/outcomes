Goal
Enable Outcomes to quote and execute arbitrary tasks against a specified GitHub repository, rather than only the allowlisted calculator fixture.

Required flow
Agent resolves the current repository:
GitHub remote URL
Current 40-character commit SHA
Base branch
If no GitHub remote exists, ask the user to create/push a repository.
Agent converts the request into a task contract:
Description
Acceptance criteria
Prohibited changes
Call quote_task.
Present the exact price and contract.
Require explicit user approval.
Call accept_quote_and_start.
Poll get_task_status.
Return the resulting branch/PR, verification result, and payment status.
Backend work needed
Remove or broaden the calculator-only repository/task allowlist.
Support arbitrary public GitHub repository URLs and commit SHAs.
Replace the hard-coded AUD 12.50 fixture price with a general pricing strategy.
Give the Cursor worker repository access and instructions to create a branch/PR.
Pass the repository URL, SHA, task contract, and base branch into the Cursor run.
Implement general verification using declared commands/tests and acceptance criteria.
Only charge after verification succeeds.
Return actionable errors for inaccessible repositories, invalid SHAs, missing tests, worker failures, and verification failures.
MCP design
The tools should drive this behavior. quote_task should require something like:

{
  repository_url: string;
  repository_sha: string;
  base_branch: string;
  task: {
    description: string;
    acceptanceCriteria: string[];
    prohibitedChanges: string[];
    verificationCommands?: string[];
  };
  idempotency_key: string;
}
Update the tool description to explicitly tell the calling agent:

Resolve “this repo” from the local Git remote and current commit SHA. If the repository has no GitHub remote or has unpushed changes, ask the user before requesting a quote.

The MCP server cannot independently know what “this repo” means—the calling coding agent must provide that context. The schema should enforce it, while the tool description teaches the agent how to obtain it.

