# Go-Gin Migration Report

Generated: 2026-04-10T10:21:38.417Z

Methodology: Node baseline services were measured from `benchmarks/node-baseline/*` and Go services from the migrated `backend` and `ai-server` directories. Runtime measurements used Docker on the same host. Backend equivalence ran against a stub AI service; AI wrapper equivalence ran against a deterministic fake engine, with separate real-engine smoke tests.

## Backend

| Metric | Node.js baseline | Go + Gin |
| --- | ---: | ---: |
| Code lines | 2985 | 4715 |
| Code files | 7 | 17 |
| Direct deps | 7 | 7 |
| Transitive deps | 103 | 69 |
| Artifact / binary size | 18.3 MiB | 21.0 MiB |
| Cold start p50 | 10703.5 ms | 685.3 ms |
| Cold start p95 | 10727.6 ms | 734.5 ms |
| Idle memory | 22.6 MiB | 3.2 MiB |
| Idle CPU | 0.00% | 0.00% |
| Load peak memory | 31.1 MiB | 8.4 MiB |
| Load peak CPU | 0.05% | 0.02% |

### Backend Response Latency

| Scenario | Node p50 | Node p95 | Go p50 | Go p95 |
| --- | ---: | ---: | ---: | ---: |
| Auth/register | 39.3 ms | 43.1 ms | 42.1 ms | 45.2 ms |
| Auth/login | 39.3 ms | 40.7 ms | 40.0 ms | 41.1 ms |
| User/me | 2.2 ms | 2.8 ms | 1.2 ms | 1.5 ms |
| Coins/spend-ai-match | 2.6 ms | 3.7 ms | 1.8 ms | 2.3 ms |
| Coins/recharge | 2.5 ms | 2.9 ms | 1.9 ms | 2.2 ms |
| Games list | 2.3 ms | 2.9 ms | 1.0 ms | 1.3 ms |
| Game detail | 2.2 ms | 2.6 ms | 1.1 ms | 1.4 ms |
| Backend /api/ai/move | 4.6 ms | 1093.3 ms | 1.5 ms | 3.2 ms |
| Socket matchmaking | 1.7 ms | 6.7 ms | 1.8 ms | 2.4 ms |
| Socket setup sync | 0.7 ms | 1.3 ms | 0.5 ms | 0.6 ms |
| Socket move relay | 0.5 ms | 0.8 ms | 0.5 ms | 0.6 ms |
| Socket pass relay | 0.7 ms | 0.9 ms | 0.5 ms | 0.6 ms |
| Socket resign end | 0.6 ms | 1.1 ms | 0.5 ms | 0.6 ms |
| Socket disconnect end | 0.5 ms | 0.8 ms | 0.5 ms | 0.6 ms |

## AI Server

| Metric | Node.js baseline | Go + Gin |
| --- | ---: | ---: |
| Code lines | 250 | 412 |
| Code files | 1 | 1 |
| Direct deps | 1 | 1 |
| Transitive deps | 64 | 42 |
| Wrapper artifact / binary size | 2.5 MiB | 7.4 MiB |
| Shared engine size | 1.1 MiB | 1.1 MiB |
| Cold start p50 | 649.6 ms | 553.2 ms |
| Cold start p95 | 701.7 ms | 566.6 ms |
| Idle memory | 102.9 MiB | 96.8 MiB |
| Idle CPU | 0.00% | 0.00% |
| Load peak memory | 104.6 MiB | 97.1 MiB |
| Load peak CPU | 0.00% | 0.00% |

| Endpoint | Node p50 | Node p95 | Go p50 | Go p95 |
| --- | ---: | ---: | ---: | ---: |
| AI /move | 2.3 ms | 5.1 ms | 1.7 ms | 3.5 ms |

## Stack Summary

| Metric | Node.js stack | Go stack |
| --- | ---: | ---: |
| Total code lines | 3235 | 5127 |
| Total code files | 8 | 18 |
| Total direct deps | 8 | 8 |
| Total transitive deps | 167 | 111 |
| Combined idle memory | 125.6 MiB | 100.0 MiB |
| Combined idle CPU | 0.00% | 0.00% |
| Combined peak load memory | 135.7 MiB | 105.4 MiB |
| Combined peak load CPU | 0.05% | 0.02% |

## Interpretation

- Backend cold-start and representative REST/socket paths favored Go in this run. The main cost that remains in both stacks is database round-trips, so list/detail and game-finalization paths stay bounded more by PostgreSQL work than by the HTTP framework alone.
- The AI wrapper did not win every runtime metric despite the Go rewrite, but still removed the Node runtime dependency from the wrapper layer. Real-engine `/move` latency stayed dominated by Fairy-Stockfish search time, so wrapper/framework changes affected startup and idle footprint more than search-heavy request latency.
- Socket.IO compatibility still carries non-trivial coordination cost in both implementations. Matchmaking and relay paths improved where Go avoided extra event-loop scheduling, but end-of-game paths remain influenced by DB writes and session bookkeeping rather than HTTP framework choice alone.
