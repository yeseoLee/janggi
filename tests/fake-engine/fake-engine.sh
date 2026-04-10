#!/bin/sh

while IFS= read -r line; do
  case "$line" in
    uci)
      echo "id name FakeFairyStockfish"
      echo "id author Codex"
      echo "uciok"
      ;;
    isready)
      echo "readyok"
      ;;
    quit)
      exit 0
      ;;
    go*)
      echo "bestmove a10a9 ponder a1a2"
      ;;
    *)
      ;;
  esac
done
