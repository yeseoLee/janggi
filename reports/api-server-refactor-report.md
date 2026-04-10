# API Server Refactor Report

Generated: 2026-04-10T19:57:36.450Z

## Equivalence
| Check | Result |
| --- | --- |
| Full HTTP + Socket scenario parity | PASS |

## Structure
| Metric | Baseline api-server | Refactored api-server |
| --- | ---: | ---: |
| Code lines | 5302 | 5800 |
| Code files | 27 | 36 |
| Direct deps | 7 | 7 |
| Transitive deps | 69 | 69 |
| Test coverage | 15.7% | 17.8% |

## HTTP Latency
| Endpoint | Baseline p50 | Baseline p95 | Refactor p50 | Refactor p95 |
| --- | ---: | ---: | ---: | ---: |
| register | 44.0 ms | 44.5 ms | 44.3 ms | 44.6 ms |
| login | 43.2 ms | 43.5 ms | 42.5 ms | 42.8 ms |
| me | 1.3 ms | 1.8 ms | 1.2 ms | 1.5 ms |
| search | 1.7 ms | 2.3 ms | 1.7 ms | 2.4 ms |
| friendRequests | 1.4 ms | 1.4 ms | 1.7 ms | 1.9 ms |
| friends | 1.1 ms | 1.4 ms | 1.2 ms | 1.4 ms |
| acceptFriend | 3.2 ms | 3.3 ms | 3.4 ms | 3.6 ms |
| rejectFriend | 2.0 ms | 2.1 ms | 1.9 ms | 2.3 ms |
| villainsAdd | 3.1 ms | 3.9 ms | 3.5 ms | 3.8 ms |
| villains | 1.7 ms | 2.0 ms | 1.2 ms | 1.4 ms |
| villainsDelete | 2.1 ms | 2.2 ms | 1.9 ms | 2.1 ms |
| spend | 2.0 ms | 2.3 ms | 1.9 ms | 2.3 ms |
| recharge | 2.0 ms | 2.2 ms | 2.0 ms | 2.3 ms |
| aiMove | 1.5 ms | 2.0 ms | 1.4 ms | 2.8 ms |
| gamesAI | 3.0 ms | 3.5 ms | 2.8 ms | 3.5 ms |
| friendGames | 1.7 ms | 1.8 ms | 2.1 ms | 2.2 ms |
| games | 1.2 ms | 1.2 ms | 1.4 ms | 1.5 ms |
| gameDetail | 1.3 ms | 1.6 ms | 1.3 ms | 1.3 ms |
| deleteFriend | 2.3 ms | 3.0 ms | 2.4 ms | 2.6 ms |
| deleteMe | 2.2 ms | 3.1 ms | 2.1 ms | 2.4 ms |
| noRoute | 0.6 ms | 0.7 ms | 0.7 ms | 0.7 ms |
