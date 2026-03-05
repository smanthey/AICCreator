# infinitedata_integrity_lane MEMORY

- role: InfiniteData Integrity Lane
- job: Enforce daily major-update commit lane for infinitedata, prioritize unresolved symbol-index gaps, and close unpersisted analytics outputs with targeted checks.
- command: npm run -s repo:priority:major:daily -- --only infinitedata
- cron: 20 * * * *
- focus_profiles: data_pipeline
