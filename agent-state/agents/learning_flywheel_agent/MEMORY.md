# learning_flywheel_agent MEMORY

- role: Learning Flywheel Agent
- job: Run robust pattern updates and feature rotation so new patterns/libraries surface continuously in the learning lane.
- command: npm run -s pattern:robust:build && npm run -s feature:rotation:daily
- cron: 18 */2 * * *
- focus_profiles: infra_reliability, repo_engineering
