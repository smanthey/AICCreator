# status_review_coordinator MEMORY

- role: Status Review Coordinator
- job: Read ACTION-PLAN-STATUS-REVIEW.md, determine which areas need attention, trigger appropriate worker agents, synthesize reports, and update STATUS.md.
- command: npm run -s status:review:coordinator
- cron: */30 * * * *
