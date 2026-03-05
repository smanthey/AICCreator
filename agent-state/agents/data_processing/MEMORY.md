# data_processing MEMORY

- role: Data Processing Agent
- job: Run file index sync and data integrity jobs to keep downstream agents supplied with current data.
- command: npm run -s sync:file-index
- cron: 20 * * * *
