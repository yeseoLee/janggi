# Backend Refactor Report

Generated: 2026-04-10T13:58:38.202Z

## Equivalence
| Check | Result |
| --- | --- |
| Full HTTP + Socket scenario parity | PASS |

## Structure
| Metric | Baseline backend | Refactored backend |
| --- | ---: | ---: |
| Code lines | 4715 | 5302 |
| Code files | 17 | 27 |
| Direct deps | 7 | 7 |
| Transitive deps | 69 | 69 |
| Test coverage | 8.9% | 16.1% |

## HTTP Latency
| Endpoint | Baseline p50 | Baseline p95 | Refactor p50 | Refactor p95 |
| --- | ---: | ---: | ---: | ---: |
| register | 42.7 ms | 43.5 ms | 43.0 ms | 43.9 ms |
| login | 41.9 ms | 42.0 ms | 41.8 ms | 42.1 ms |
| me | 1.3 ms | 1.6 ms | 1.2 ms | 1.6 ms |
| search | 1.5 ms | 1.9 ms | 1.3 ms | 2.1 ms |
| friendRequests | 1.4 ms | 1.4 ms | 1.4 ms | 1.7 ms |
| friends | 1.2 ms | 1.4 ms | 1.3 ms | 1.3 ms |
| acceptFriend | 3.2 ms | 3.4 ms | 3.4 ms | 8.0 ms |
| rejectFriend | 1.9 ms | 2.2 ms | 2.4 ms | 3.0 ms |
| villainsAdd | 3.3 ms | 4.1 ms | 3.7 ms | 4.8 ms |
| villains | 1.1 ms | 1.4 ms | 1.2 ms | 1.5 ms |
| villainsDelete | 1.9 ms | 2.1 ms | 2.0 ms | 3.5 ms |
| spend | 2.3 ms | 2.7 ms | 2.2 ms | 5.8 ms |
| recharge | 2.2 ms | 2.4 ms | 2.3 ms | 2.9 ms |
| aiMove | 1.6 ms | 2.6 ms | 1.7 ms | 3.4 ms |
| gamesAI | 2.8 ms | 3.6 ms | 4.9 ms | 7.1 ms |
| friendGames | 1.7 ms | 1.7 ms | 1.8 ms | 1.8 ms |
| games | 1.5 ms | 1.6 ms | 1.3 ms | 1.4 ms |
| gameDetail | 1.3 ms | 1.4 ms | 1.3 ms | 1.3 ms |
| deleteFriend | 2.4 ms | 2.6 ms | 2.4 ms | 2.4 ms |
| deleteMe | 2.2 ms | 2.2 ms | 2.2 ms | 2.2 ms |
| noRoute | 0.7 ms | 0.7 ms | 0.7 ms | 0.8 ms |
