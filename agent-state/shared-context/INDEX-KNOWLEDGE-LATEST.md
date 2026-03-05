# Shared Index Knowledge

- generated_at: 2026-03-04T11:21:19.673Z
- symbolic repos indexed: 8/20
- repomap repos: 70
- readiness below threshold: 35
- remediations queued: 35

## Weakest Repos

- local/clawpay: score=30 reasons=index_missing,repomap_missing
- local/dify: score=54 reasons=index_missing
- local/flowise: score=54 reasons=index_missing
- local/maxkb: score=54 reasons=index_missing
- local/sim: score=54 reasons=index_missing
- local/crave: score=60 reasons=index_missing
- local/foodtruckpass: score=60 reasons=index_missing
- local/gbusupdate: score=60 reasons=index_missing
- local/glitch-app: score=60 reasons=index_missing
- local/inayanbuilderbot: score=60 reasons=index_missing
- local/infinitedata: score=60 reasons=index_missing
- local/leadgengit: score=60 reasons=index_missing
- local/madirectory: score=60 reasons=index_missing
- local/mediatranscribepro: score=60 reasons=index_missing
- local/mytutor: score=60 reasons=index_missing

## Top Features

- symbol_failure_mapping: scripts/pm2-failure-symbol-triage.js::enqueueTask#function | scripts/pm2-failure-symbol-triage.js::errorLines#function | scripts/pm2-failure-symbol-triage.js::main#function
- cdp_network_contracts: tests/e2e/fixtures.ts::assertNoConsoleErrors#function | control/replay-hash.js::replayMiddleware#function | client/src/lib/queryClient.ts::apiRequest#function
- auto_wait_stability: integration-tests/helpers/retry.ts::fetchAndRetry#function | tests/e2e/fixtures.ts::waitForPageLoad#function | tests/e2e/fixtures.ts::waitForJsonResponse#function
- selector_resilience: server/cron.ts::retryQuery#function | server/services/ab-testing.ts::ABTestingService.recordTestResult#method | tests/e2e/fixtures.ts::expectTextContent#function
- visual_regression_baselines: integration-tests/helpers/wait-for-index.ts::waitForIndexedEntities#function | integration-tests/helpers/wait-for-index.ts::WaitForIndexOptions#type | integration-tests/helpers/retry.ts::fetchAndRetry#function
- trace_replay_debug: client/src/components/ui/chart.tsx::ChartConfig#type | server/services/webhookService.ts::parseMailerooWebhook#function | server/services/emailQueue.ts::queueEmail#function
