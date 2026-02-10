import assert from "node:assert/strict";
import test from "node:test";

import {
  getTasmeeStartFailurePolicy,
  isDeltaForActiveTasmeeSession,
  isTasmeeMockEnabled,
  isTruthyEnvFlag,
} from "./tasmeeSessionPolicy";

test("truthy env parser supports common truthy values", () => {
  assert.equal(isTruthyEnvFlag("true"), true);
  assert.equal(isTruthyEnvFlag("TRUE"), true);
  assert.equal(isTruthyEnvFlag(" 1 "), true);
  assert.equal(isTruthyEnvFlag("yes"), true);
  assert.equal(isTruthyEnvFlag("on"), true);
});

test("truthy env parser rejects falsy and empty values", () => {
  assert.equal(isTruthyEnvFlag(undefined), false);
  assert.equal(isTruthyEnvFlag(null), false);
  assert.equal(isTruthyEnvFlag(""), false);
  assert.equal(isTruthyEnvFlag("0"), false);
  assert.equal(isTruthyEnvFlag("false"), false);
});

test("start failure policy disables mock by default", () => {
  const policy = getTasmeeStartFailurePolicy(undefined);
  assert.equal(policy.useMockProgress, false);
  assert.equal(policy.nextStatus, "error");
  assert.ok(policy.errorMessage);
});

test("start failure policy enables mock only when flag is truthy", () => {
  assert.equal(isTasmeeMockEnabled("true"), true);
  assert.equal(isTasmeeMockEnabled("1"), true);
  assert.equal(isTasmeeMockEnabled("false"), false);
  assert.equal(isTasmeeMockEnabled(undefined), false);

  const policy = getTasmeeStartFailurePolicy("true");
  assert.equal(policy.useMockProgress, true);
  assert.equal(policy.nextStatus, "listening");
  assert.equal(policy.errorMessage, null);
});

test("delta events are accepted only for the active session", () => {
  assert.equal(
    isDeltaForActiveTasmeeSession(null, { session_id: "active-session" }),
    false,
  );
  assert.equal(
    isDeltaForActiveTasmeeSession("active-session", {
      session_id: "stale-session",
    }),
    false,
  );
  assert.equal(
    isDeltaForActiveTasmeeSession("active-session", {
      session_id: "active-session",
    }),
    true,
  );
});

