export const APPROVAL_TTL_MS = 48 * 60 * 60 * 1000;

export function createDemoState() {
  return {
    items: [
      { id: "pizza-leftover", name: "Pizza", owner: "Alex", quantity: 25, unit: "%", status: "available" },
      { id: "ketchup-sam", name: "Ketchup", owner: "Sam", quantity: 1, unit: "bottle", status: "available" },
      { id: "ketchup-jo", name: "Ketchup", owner: "Jo", quantity: 1, unit: "bottle", status: "available" }
    ],
    requests: [],
    events: [
      { id: "welcome", message: "FridgePolice is ready. The demo shelf has 25% pizza and two separately tracked ketchup bottles.", at: Date.now() }
    ]
  };
}

function record(state, message, now) {
  return {
    ...state,
    events: [{ id: crypto.randomUUID(), message, at: now }, ...state.events].slice(0, 30)
  };
}

function itemFor(state, itemId) {
  const item = state.items.find((candidate) => candidate.id === itemId);
  if (!item) throw new Error("That food item no longer exists.");
  return item;
}

function withExpiry(state, now) {
  const expired = state.requests.filter(
    (request) => request.status === "approved" && request.expiresAt <= now
  );
  if (expired.length === 0) return state;

  const expiredIds = new Set(expired.map((request) => request.id));
  const next = {
    ...state,
    requests: state.requests.map((request) =>
      expiredIds.has(request.id) ? { ...request, status: "expired" } : request
    )
  };
  return expired.reduce(
    (current, request) => record(current, `${request.requester}’s approval for ${itemFor(current, request.itemId).name} expired unused; no food was deducted.`, now),
    next
  );
}

export function availableQuantity(state, itemId, now = Date.now()) {
  const current = withExpiry(state, now);
  const item = itemFor(current, itemId);
  if (item.status !== "available") return 0;
  const reserved = current.requests
    .filter((request) => request.itemId === itemId && request.status === "approved")
    .reduce((total, request) => total + request.amount, 0);
  return Math.max(0, item.quantity - reserved);
}

export function expireApprovals(state, now = Date.now()) {
  return withExpiry(state, now);
}

export function requestPortion(state, { itemId, requester, amount, now = Date.now(), requestId = crypto.randomUUID() }) {
  const current = withExpiry(state, now);
  const item = itemFor(current, itemId);
  const quantity = Number(amount);
  const name = requester.trim();
  if (!name) throw new Error("Enter the roommate requesting this portion.");
  if (!Number.isFinite(quantity) || quantity <= 0) throw new Error("Request an amount greater than zero.");
  if (item.status !== "available" || availableQuantity(current, itemId, now) < quantity) {
    throw new Error("There isn’t enough unreserved food for that request.");
  }
  const request = { id: requestId, itemId, requester: name, amount: quantity, status: "pending", createdAt: now };
  return record({ ...current, requests: [...current.requests, request] }, `${name} requested ${quantity} ${item.unit} of ${item.name} (owned by ${item.owner}).`, now);
}

export function approveRequest(state, requestId, now = Date.now()) {
  const current = withExpiry(state, now);
  const request = current.requests.find((candidate) => candidate.id === requestId);
  if (!request || request.status !== "pending") throw new Error("This request is no longer waiting for approval.");
  const item = itemFor(current, request.itemId);
  if (availableQuantity(current, item.id, now) < request.amount) {
    throw new Error(`Not enough unreserved ${item.name} remains. Another approval may already hold it.`);
  }
  const next = {
    ...current,
    requests: current.requests.map((candidate) => candidate.id === requestId
      ? { ...candidate, status: "approved", expiresAt: now + APPROVAL_TTL_MS }
      : candidate)
  };
  return record(next, `${request.requester}’s ${request.amount} ${item.unit} of ${item.name} was approved; it is reserved for 48 hours.`, now);
}

export function rejectRequest(state, requestId, now = Date.now()) {
  const current = withExpiry(state, now);
  const request = current.requests.find((candidate) => candidate.id === requestId);
  if (!request || request.status !== "pending") throw new Error("This request is no longer waiting for a decision.");
  const item = itemFor(current, request.itemId);
  const next = {
    ...current,
    requests: current.requests.map((candidate) => candidate.id === requestId ? { ...candidate, status: "rejected" } : candidate)
  };
  return record(next, `${request.requester}’s request for ${item.name} was declined; inventory was unchanged.`, now);
}

export function consumeRequest(state, requestId, now = Date.now()) {
  const current = withExpiry(state, now);
  const request = current.requests.find((candidate) => candidate.id === requestId);
  if (!request || request.status !== "approved") throw new Error("Only an active, approved portion can be consumed.");
  const item = itemFor(current, request.itemId);
  if (item.status !== "available" || item.quantity < request.amount) {
    throw new Error("That portion is no longer available. Correct the inventory before recording consumption.");
  }
  const remaining = item.quantity - request.amount;
  const next = {
    ...current,
    items: current.items.map((candidate) => candidate.id === item.id
      ? { ...candidate, quantity: remaining, status: remaining === 0 ? "gone" : "available" }
      : candidate),
    requests: current.requests.map((candidate) => candidate.id === requestId ? { ...candidate, status: "consumed" } : candidate)
  };
  return record(next, `${request.requester} consumed ${request.amount} ${item.unit} of ${item.name}; ${remaining} ${item.unit} remains.`, now);
}

function cancelOpenRequests(state, itemId, now) {
  const cancelled = state.requests.filter(
    (request) => request.itemId === itemId && (request.status === "pending" || request.status === "approved")
  );
  const cancelledIds = new Set(cancelled.map((request) => request.id));
  const next = {
    ...state,
    requests: state.requests.map((request) =>
      cancelledIds.has(request.id) ? { ...request, status: "cancelled" } : request
    )
  };
  const item = itemFor(next, itemId);
  return cancelled.reduce(
    (current, request) => record(current, `${request.requester}’s ${item.name} request was cancelled because its inventory changed.`, now),
    next
  );
}

export function discardAsSpoiled(state, itemId, now = Date.now()) {
  let current = withExpiry(state, now);
  const item = itemFor(current, itemId);
  if (item.status === "spoiled") throw new Error("This item has already been marked spoiled.");
  current = cancelOpenRequests(current, itemId, now);
  current = {
    ...current,
    items: current.items.map((candidate) => candidate.id === itemId
      ? { ...candidate, quantity: 0, status: "spoiled" }
      : candidate)
  };
  return record(current, `${item.name} owned by ${item.owner} spoiled and was discarded. Active requests were cancelled without charging anyone.`, now);
}

export function correctInventory(state, itemId, amount, now = Date.now()) {
  let current = withExpiry(state, now);
  const item = itemFor(current, itemId);
  const quantity = Number(amount);
  if (item.status === "spoiled") throw new Error("A spoiled item cannot be restored; add a fresh item instead.");
  if (!Number.isFinite(quantity) || quantity < 0) throw new Error("Inventory must be zero or a positive amount.");
  current = cancelOpenRequests(current, itemId, now);
  current = {
    ...current,
    items: current.items.map((candidate) => candidate.id === itemId
      ? { ...candidate, quantity, status: quantity === 0 ? "gone" : "available" }
      : candidate)
  };
  return record(current, `Actual ${item.name} inventory for ${item.owner} corrected to ${quantity} ${item.unit}; open requests were cancelled.`, now);
}

export function addItem(state, { name, owner, quantity, unit, now = Date.now(), itemId = crypto.randomUUID() }) {
  const current = withExpiry(state, now);
  const cleanName = name.trim();
  const cleanOwner = owner.trim();
  const cleanUnit = unit.trim();
  const amount = Number(quantity);
  if (!cleanName || !cleanOwner || !cleanUnit) throw new Error("Enter an item name, roommate, and unit.");
  if (!Number.isFinite(amount) || amount <= 0) throw new Error("New items must have an amount greater than zero.");
  if (current.items.some((item) => item.id === itemId)) throw new Error("That item ID is already in use.");
  const item = { id: itemId, name: cleanName, owner: cleanOwner, quantity: amount, unit: cleanUnit, status: "available" };
  return record({ ...current, items: [...current.items, item] }, `${cleanOwner} added ${amount} ${cleanUnit} of ${cleanName}.`, now);
}
