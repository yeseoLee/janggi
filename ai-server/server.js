const express = require('express');
const { spawn } = require('child_process');
const readline = require('readline');

const PORT = Number(process.env.PORT || 4000);
const STOCKFISH_PATH = process.env.STOCKFISH_PATH || '/usr/local/bin/fairy-stockfish';
const AI_VARIANT = process.env.AI_VARIANT || 'janggi';
const DEFAULT_MOVE_TIME_MS = Number(process.env.AI_MOVE_TIME_MS || 700);

const clampMoveTime = (value) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return DEFAULT_MOVE_TIME_MS;
  return Math.max(100, Math.min(5000, Math.floor(parsed)));
};

class FairyStockfishEngine {
  constructor({ binaryPath, variant }) {
    this.binaryPath = binaryPath;
    this.variant = variant;
    this.child = null;
    this.rl = null;
    this.initialized = false;
    this.queue = Promise.resolve();
    this.waiters = [];
  }

  enqueue(task) {
    const run = this.queue.then(task, task);
    this.queue = run.catch(() => {});
    return run;
  }

  startProcess() {
    if (this.child && !this.child.killed) return;

    this.child = spawn(this.binaryPath, [], {
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    this.rl = readline.createInterface({ input: this.child.stdout });
    this.rl.on('line', (line) => {
      this.consumeLine(line.trim());
    });

    this.child.stderr.on('data', (chunk) => {
      const message = chunk.toString().trim();
      if (message.length > 0) {
        console.error(`[fairy-stockfish] ${message}`);
      }
    });

    this.child.on('close', (code, signal) => {
      const reason = `Fairy-Stockfish exited (code=${code}, signal=${signal})`;
      this.initialized = false;
      this.child = null;
      if (this.rl) {
        this.rl.removeAllListeners();
        this.rl = null;
      }
      this.rejectAllWaiters(new Error(reason));
    });
  }

  consumeLine(line) {
    if (line.length === 0) return;
    for (let index = 0; index < this.waiters.length; index += 1) {
      const waiter = this.waiters[index];
      if (!waiter.matcher(line)) continue;
      clearTimeout(waiter.timeout);
      this.waiters.splice(index, 1);
      waiter.resolve(line);
      return;
    }
  }

  rejectAllWaiters(error) {
    for (const waiter of this.waiters) {
      clearTimeout(waiter.timeout);
      waiter.reject(error);
    }
    this.waiters = [];
  }

  waitForLine(matcher, timeoutMs) {
    return new Promise((resolve, reject) => {
      if (!this.child || this.child.killed) {
        reject(new Error('Fairy-Stockfish process is not running.'));
        return;
      }

      const timeout = setTimeout(() => {
        this.waiters = this.waiters.filter((waiter) => waiter.resolve !== resolve);
        reject(new Error(`Timed out waiting for engine output (${timeoutMs}ms).`));
      }, timeoutMs);

      this.waiters.push({
        matcher,
        resolve,
        reject,
        timeout,
      });
    });
  }

  send(command) {
    if (!this.child || this.child.killed || !this.child.stdin.writable) {
      throw new Error('Fairy-Stockfish process is not writable.');
    }
    this.child.stdin.write(`${command}\n`);
  }

  async commandAndWait(command, matcher, timeoutMs) {
    const waiter = this.waitForLine(matcher, timeoutMs);
    this.send(command);
    return waiter;
  }

  async ensureInitialized() {
    await this.enqueue(async () => {
      if (this.initialized && this.child && !this.child.killed) return;

      this.startProcess();
      await this.commandAndWait('uci', (line) => line === 'uciok', 12000);
      this.send(`setoption name UCI_Variant value ${this.variant}`);
      await this.commandAndWait('isready', (line) => line === 'readyok', 12000);
      this.initialized = true;
    });
  }

  async getBestMove({ fen, movetime, depth }) {
    await this.ensureInitialized();

    return this.enqueue(async () => {
      this.send(`position fen ${fen}`);

      const goCommand =
        Number.isInteger(depth) && depth > 0
          ? `go depth ${depth}`
          : `go movetime ${clampMoveTime(movetime)}`;

      const timeoutMs = Number.isInteger(depth) && depth > 0
        ? 15000
        : Math.max(8000, clampMoveTime(movetime) * 4);

      const bestMoveLine = await this.commandAndWait(
        goCommand,
        (line) => line.startsWith('bestmove '),
        timeoutMs,
      );

      const parts = bestMoveLine.split(/\s+/);
      return {
        bestmove: parts[1] || '(none)',
        ponder: parts[3] || null,
      };
    });
  }

  shutdown() {
    if (!this.child || this.child.killed) return;

    try {
      this.send('quit');
    } catch (_err) {
      // ignore
    }

    setTimeout(() => {
      if (this.child && !this.child.killed) {
        this.child.kill('SIGTERM');
      }
    }, 500);
  }
}

const engine = new FairyStockfishEngine({
  binaryPath: STOCKFISH_PATH,
  variant: AI_VARIANT,
});

const app = express();
app.use(express.json({ limit: '1mb' }));

app.get('/health', (_req, res) => {
  res.json({
    ok: true,
    initialized: engine.initialized,
    variant: AI_VARIANT,
    pid: engine.child?.pid || null,
  });
});

app.post('/move', async (req, res) => {
  const { fen, movetime, depth } = req.body || {};
  if (typeof fen !== 'string' || fen.trim().length === 0) {
    return res.status(400).json({ error: 'fen is required' });
  }

  try {
    const result = await engine.getBestMove({
      fen: fen.trim(),
      movetime: clampMoveTime(movetime),
      depth: Number.isInteger(depth) ? depth : undefined,
    });
    return res.json(result);
  } catch (err) {
    console.error('Failed to calculate AI move:', err);
    return res.status(500).json({ error: 'Failed to calculate AI move' });
  }
});

const server = app.listen(PORT, async () => {
  try {
    await engine.ensureInitialized();
    console.log(`AI server listening on port ${PORT}`);
  } catch (err) {
    console.error('Failed to initialize Fairy-Stockfish on startup:', err);
  }
});

const shutdown = () => {
  engine.shutdown();
  server.close(() => process.exit(0));
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
