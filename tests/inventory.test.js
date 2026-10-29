import test from "node:test";
import assert from "node:assert/strict";
import {
  APPROVAL_TTL_MS,
  addItem,
  approveRequest,
  availableQuantity,
  consumeRequest,
  correctInventory,
  createDemoState,
  discardAsSpoiled,
  expireApprovals,
  rejectRequest,
  requestPortion
} from "../inventory.js";

const start = 1_800_000_000_000;

function request(state, itemId, requester, amount, suffix, now = start) {
  return requestPortion(state, { itemId, requester, amount, now, requestId: `request-${suffix}` });
}

test("only one roommate can be approved for the final 25% of pizza", () => {
  let state = createDemoState();
  state = request(state, "pizza-leftover", "B", 25, "b");
  state = request(state, "pizza-leftover", "C", 25, "c");
  state = approveRequest(state, "request-b", start + 1);
  assert.equal(availableQuantity(state, "pizza-leftover", start + 1), 0);
  assert.throws(() => approveRequest(state, "request-c", start + 2), /Not enough unreserved/);
  assert.equal(state.requests.find((entry) => entry.id === "request-c").status, "pending");
  assert.equal(state.items.find((item) => item.id === "pizza-leftover").quantity, 25);
});

test("unclaimed approvals expire after 48 hours without deducting food", () => {
  let state = request(createDemoState(), "pizza-leftover", "B", 25, "b");
  state = approveRequest(state, "request-b", start);
  state = expireApprovals(state, start + APPROVAL_TTL_MS);
  assert.equal(state.requests[0].status, "expired");
  assert.equal(availableQuantity(state, "pizza-leftover", start + APPROVAL_TTL_MS), 25);
  assert.equal(state.items[0].quantity, 25);
  assert.match(state.events[0].message, /expired unused; no food was deducted/);
});

test("discarding spoiled food cancels reservations without charging the roommate", () => {
  let state = request(createDemoState(), "pizza-leftover", "B", 25, "b");
  state = approveRequest(state, "request-b", start + 1);
  state = discardAsSpoiled(state, "pizza-leftover", start + 2);
  assert.equal(state.items[0].quantity, 0);
  assert.equal(state.items[0].status, "spoiled");
  assert.equal(state.requests[0].status, "cancelled");
  assert.equal(availableQuantity(state, "pizza-leftover", start + 2), 0);
  assert.throws(() => consumeRequest(state, "request-b", start + 3), /active, approved/);
});

test("same-named items have independent identities, owners, and quantities", () => {
  const state = createDemoState();
  const sam = state.items.find((item) => item.id === "ketchup-sam");
  const jo = state.items.find((item) => item.id === "ketchup-jo");
  assert.equal(sam.name, jo.name);
  assert.notEqual(sam.id, jo.id);
  let next = correctInventory(state, sam.id, 0, start);
  assert.equal(next.items.find((item) => item.id === sam.id).status, "gone");
  assert.equal(next.items.find((item) => item.id === jo.id).quantity, 1);
});

test("inventory correction to zero cancels stale approvals and marks food gone", () => {
  let state = request(createDemoState(), "pizza-leftover", "B", 25, "b");
  state = approveRequest(state, "request-b", start + 1);
  state = correctInventory(state, "pizza-leftover", 0, start + 2);
  assert.equal(state.items[0].status, "gone");
  assert.equal(state.items[0].quantity, 0);
  assert.equal(state.requests[0].status, "cancelled");
  assert.equal(availableQuantity(state, "pizza-leftover", start + 2), 0);
});

test("consumption deducts stock exactly once and changes request state", () => {
  let state = request(createDemoState(), "pizza-leftover", "B", 10, "b");
  state = approveRequest(state, "request-b", start + 1);
  state = consumeRequest(state, "request-b", start + 2);
  assert.equal(state.items[0].quantity, 15);
  assert.equal(state.requests[0].status, "consumed");
  assert.throws(() => consumeRequest(state, "request-b", start + 3), /active, approved/);
});

test("pending requests can be rejected without changing inventory", () => {
  let state = request(createDemoState(), "pizza-leftover", "B", 10, "b");
  state = rejectRequest(state, "request-b", start + 1);
  assert.equal(state.requests[0].status, "rejected");
  assert.equal(state.items[0].quantity, 25);
});

test("new duplicate item names get distinct IDs", () => {
  let state = createDemoState();
  state = addItem(state, { name: "Ketchup", owner: "Pat", quantity: 1, unit: "bottle", now: start, itemId: "ketchup-pat" });
  assert.equal(state.items.filter((item) => item.name === "Ketchup").length, 3);
  assert.equal(new Set(state.items.map((item) => item.id)).size, state.items.length);
});
