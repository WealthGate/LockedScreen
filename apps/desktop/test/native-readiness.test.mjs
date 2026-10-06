import assert from 'node:assert/strict';
import test from 'node:test';
import { EventEmitter } from 'node:events';
import { build } from 'esbuild';

test('native readiness and recovery use real command outcomes rather than service presence', async t => {
  const state = { calls: [], missing: false, agentDenied: false, agentRunning: false, rejectBegin: false, failStop: false, unhealthy: false };
  globalThis.nativeReadinessTest = {
    existsSync: () => !state.missing,
    spawn: (file, args) => {
      state.calls.push([file, ...args]);
      const child = new EventEmitter();
      child.stdout = new EventEmitter(); child.stderr = new EventEmitter();
      child.unref = () => {}; child.kill = () => {};
      queueMicrotask(() => {
        if (file.includes('.Agent.') && state.agentDenied) { child.emit('error', new Error('Access denied')); return; }
        const command = args[0];
        const agent = file.includes('.Agent.');
        if (agent && command === 'run') { state.agentRunning = true; return; }
        const code = (command === 'begin-session' && state.rejectBegin) || (command === 'stop' && state.failStop) ? 1 : 0;
        // stdout can arrive after process exit; consumers must wait for close.
        child.emit('exit', code);
        queueMicrotask(() => {
          const response = agent ? { running: state.agentRunning } : { ok: !state.unhealthy, status: { sessionActive: false } };
          child.stdout.emit('data', Buffer.from(JSON.stringify(response)));
          child.emit('close', code);
        });
      });
      return child;
    },
    execFile: (_file, args, options, cb) => {
      assert.equal(options.timeout, 5000);
      cb(null, args.join(' ').includes('EditionID') ? 'Core' : 'missing');
    }
  };
  const compile = async entry => {
    const result = await build({ entryPoints: [entry], bundle: true, platform: 'node', format: 'esm', write: false,
      plugins: [{ name: 'mock-native', setup(builder) {
        builder.onResolve({ filter: /^(node:child_process|node:fs|electron|@lockedscreen\/storage)$/ }, args => ({ path: args.path, namespace: 'mock' }));
        builder.onLoad({ filter: /.*/, namespace: 'mock' }, args => ({ contents:
          args.path === 'node:child_process' ? 'export const spawn = (...args) => globalThis.nativeReadinessTest.spawn(...args); export const execFile = (...args) => globalThis.nativeReadinessTest.execFile(...args);'
          : args.path === 'node:fs' ? 'export const existsSync = (...args) => globalThis.nativeReadinessTest.existsSync(...args);'
          : args.path === 'electron' ? 'export const screen = { getAllDisplays: () => [{}] };'
          : 'export const calculateConfigPackageChecksum = () => "test";'
        }));
      } }]
    });
    return import('data:text/javascript;base64,' + Buffer.from(result.outputFiles[0].text).toString('base64'));
  };
  const previous = process.resourcesPath;
  process.resourcesPath = 'C:/test/resources';
  t.mock.method(console, 'warn', () => {});
  try {
    const native = await compile('apps/desktop/src/main/security/native-security.ts');
    const diagnostics = await compile('apps/desktop/src/main/security/diagnostics.ts');
    await t.test('per-user coordinator works without an installed Windows service', async () => {
      const runtime = await diagnostics.createRuntimeEnvironment();
      assert.equal(runtime.nativeLockdown.servicePresent, false);
      assert.equal(runtime.nativeLockdown.lockdownCapable, true);
      assert.equal(runtime.nativeLockdown.agentResponding, true);
      assert.equal(runtime.canOnlyUseTestingMode, false);
      assert(state.calls.every(([, command]) => command === 'status'));
    });
    await t.test('a fresh check detects helper failure and reports its reason', async () => {
      state.agentDenied = true;
      const runtime = await diagnostics.createRuntimeEnvironment();
      assert.equal(runtime.nativeLockdown.lockdownCapable, false);
      assert.match(runtime.nativeLockdown.detail, /Access denied/);
      assert.equal(runtime.canOnlyUseTestingMode, true);
      state.agentDenied = false;
    });
    await t.test('missing helper files never count as ready', async () => {
      state.missing = true;
      assert.equal((await native.probeNativeReadiness()).ready, false);
      state.missing = false;
    });
    for (const audit of [() => Promise.reject(new Error('audit unavailable')), () => new Promise(() => {})]) {
      await t.test('failed agent stop and failed/stalled audit do not prevent companion release', async () => {
        state.calls = []; state.failStop = true;
        await native.endNativeLockdownSession(audit);
        assert(state.calls.some(([, command]) => command === 'end-session'));
        state.failStop = false;
      });
    }
    await t.test('session-start rejection rolls back the agent', async () => {
      state.calls = []; state.rejectBegin = true;
      await assert.rejects(native.beginNativeLockdownSession(
        { examId: 'fictional', packageId: 'test', mode: 'app' },
        { label: 'Test', securityMode: 'full-kiosk', processPolicy: { enabled: false, disallowedProcessNames: [] } }, async () => {}
      ));
      const begin = state.calls.findIndex(([, command]) => command === 'begin-session');
      assert(begin >= 0);
      assert(state.calls.slice(begin + 1).some(([, command]) => command === 'stop'));
      assert(state.calls.slice(begin + 1).some(([, command]) => command === 'end-session'));
    });
  } finally {
    if (previous === undefined) delete process.resourcesPath; else process.resourcesPath = previous;
    delete globalThis.nativeReadinessTest;
  }
});
