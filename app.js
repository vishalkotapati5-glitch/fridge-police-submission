import {
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
} from "./inventory.js";

const STORAGE_KEY = "fridge-police-state-v1";
const inventoryElement = document.querySelector("#inventory");
const activityElement = document.querySelector("#activity");
const noticeElement = document.querySelector("#notice");
let noticeTimer;

function loadState() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (!saved) return createDemoState();
    const state = JSON.parse(saved);
    if (!Array.isArray(state.items) || !Array.isArray(state.requests) || !Array.isArray(state.events)) {
      throw new Error("Saved fridge data is incomplete.");
    }
    return expireApprovals(state);
  } catch (error) {
    localStorage.removeItem(STORAGE_KEY);
    throw new Error(`Could not load saved fridge data: ${error.message}`);
  }
}

let state = loadState();

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[character]);
}

function formatAmount(amount, unit) {
  return `${new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(Number(amount))} ${escapeHtml(unit)}`;
}

function statusLabel(status) {
  return ({ available: "On the shelf", gone: "Marked gone", spoiled: "Spoiled · discarded" })[status];
}

function requestStatusLabel(status) {
  return ({
    pending: "Waiting for approval",
    approved: "Reserved · awaiting pickup",
    consumed: "Consumed",
    expired: "Expired unused",
    rejected: "Declined",
    cancelled: "Cancelled"
  })[status];
}

function showNotice(message, isError = false) {
  window.clearTimeout(noticeTimer);
  noticeElement.textContent = message;
  noticeElement.className = `notice${isError ? " notice-error" : ""}`;
  noticeElement.hidden = false;
  noticeTimer = window.setTimeout(() => { noticeElement.hidden = true; }, 6000);
}

function saveAndRender(message) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  render();
  if (message) showNotice(message);
}

function runAction(action) {
  try {
    state = action(state);
    saveAndRender();
  } catch (error) {
    showNotice(error.message, true);
  }
}

function renderItem(item) {
  const available = availableQuantity(state, item.id);
  const activeRequests = state.requests.filter((request) => request.itemId === item.id
    && ["pending", "approved"].includes(request.status));
  const history = state.requests.filter((request) => request.itemId === item.id)
    .sort((a, b) => a.createdAt - b.createdAt)
    .map((request) => {
      const actions = request.status === "pending"
        ? `<div class="request-actions">
            <button class="approve-button" data-action="approve" data-id="${escapeHtml(request.id)}">Approve</button>
            <button class="decline-button" data-action="reject" data-id="${escapeHtml(request.id)}">Decline</button>
          </div>`
        : request.status === "approved"
          ? `<div class="request-actions">
              <button class="approve-button" data-action="consume" data-id="${escapeHtml(request.id)}">Mark consumed</button>
              <span class="expiry-copy">Expires ${new Date(request.expiresAt).toLocaleString()}</span>
            </div>`
          : "";
      return `<li class="request-row">
        <div><strong>${escapeHtml(request.requester)}</strong><span>${formatAmount(request.amount, item.unit)} · ${requestStatusLabel(request.status)}</span></div>
        ${actions}
      </li>`;
    }).join("");
  const unitId = `correction-${escapeHtml(item.id)}`;
  const disabled = item.status !== "available" ? "disabled" : "";
  const icon = item.name.toLowerCase().includes("pizza") ? "🍕"
    : item.name.toLowerCase().includes("ketchup") ? "🍅"
      : "🥬";

  return `<article class="food-card ${item.status !== "available" ? "food-card-inactive" : ""}">
    <div class="food-card-head">
      <span class="food-icon" aria-hidden="true">${icon}</span>
      <span class="status-chip status-${escapeHtml(item.status)}">${statusLabel(item.status)}</span>
    </div>
    <h3>${escapeHtml(item.name)}</h3>
    <p class="item-owner">Added by ${escapeHtml(item.owner)} <span class="item-id">· ID ${escapeHtml(item.id)}</span></p>
    <div class="quantity-block"><strong>${formatAmount(item.quantity, item.unit)}</strong><span>in the fridge</span></div>
    ${item.status === "available" ? `<div class="availability-bar"><span style="width:${item.quantity === 0 ? 0 : Math.max(4, Math.min(100, available / item.quantity * 100))}%"></span></div>
    <p class="available-copy"><strong>${formatAmount(available, item.unit)}</strong> available to request${available < item.quantity ? " · some reserved" : ""}</p>` : `<p class="available-copy">${item.status === "spoiled" ? "No one is charged for unclaimed food." : "Check the real fridge before adding more."}</p>`}
    ${activeRequests.length ? `<div class="requests-block"><p class="eyebrow">PORTION REQUESTS</p><ul class="request-list">${history}</ul></div>` : ""}
    ${item.status === "available" ? `<form class="request-form" data-form="request" data-item="${escapeHtml(item.id)}">
      <p class="eyebrow">ASK FOR A PORTION</p>
      <div class="inline-form">
        <input name="requester" required maxlength="40" aria-label="Roommate requesting ${escapeHtml(item.name)}" placeholder="Roommate" value="B">
        <input name="amount" required type="number" min="0.01" step="any" max="${item.quantity}" aria-label="Amount of ${escapeHtml(item.name)} to request" value="${item.name.toLowerCase() === "pizza" ? Math.min(25, item.quantity) : 1}">
        <button class="primary-button" type="submit">Request</button>
      </div>
    </form>
    <details class="item-tools"><summary>Update fridge reality</summary>
      <form class="correction-form" data-form="correction" data-item="${escapeHtml(item.id)}">
        <label for="${unitId}">Amount actually in fridge (${escapeHtml(item.unit)})</label>
        <div class="inline-form"><input id="${unitId}" name="quantity" type="number" min="0" step="any" required value="${item.quantity}">
        <button class="secondary-button" type="submit">Correct amount</button></div>
      </form>
      <button class="discard-button" type="button" data-action="discard" data-id="${escapeHtml(item.id)}">Mark spoiled &amp; discard</button>
    </details>` : ""}
    ${history && !activeRequests.length ? `<details class="past-requests"><summary>Portion history (${requestsCount(state, item.id)})</summary><ul class="request-list">${history}</ul></details>` : ""}
  </article>`;
}

function render() {
  state = expireApprovals(state);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  document.querySelector("#item-count").textContent = `${state.items.length} ${state.items.length === 1 ? "item" : "items"}`;
  inventoryElement.innerHTML = state.items.length
    ? state.items.map(renderItem).join("")
    : `<div class="empty-state">Nothing in the fridge yet. Add the first item below.</div>`;
  activityElement.innerHTML = state.events.length
    ? state.events.slice(0, 8).map((event) => `<li><span class="activity-dot"></span><div><p>${escapeHtml(event.message)}</p><time>${new Date(event.at).toLocaleString()}</time></div></li>`).join("")
    : `<li class="empty-activity">No activity yet.</li>`;
}

function requestsCount(currentState, itemId) {
  return currentState.requests.filter((request) => request.itemId === itemId).length;
}

inventoryElement.addEventListener("submit", (event) => {
  const form = event.target.closest("form[data-form]");
  if (!form) return;
  event.preventDefault();
  const values = new FormData(form);
  const itemId = form.dataset.item;
  if (form.dataset.form === "request") {
    runAction((current) => requestPortion(current, {
      itemId,
      requester: values.get("requester"),
      amount: values.get("amount")
    }));
    return;
  }
  runAction((current) => correctInventory(current, itemId, values.get("quantity")));
});

inventoryElement.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-action]");
  if (!button) return;
  const { action, id } = button.dataset;
  if (action === "discard" && !window.confirm("Discard this food as spoiled? Pending and approved portions will be cancelled.")) return;
  const actions = {
    approve: (current) => approveRequest(current, id),
    reject: (current) => rejectRequest(current, id),
    consume: (current) => consumeRequest(current, id),
    discard: (current) => discardAsSpoiled(current, id)
  };
  runAction(actions[action]);
});

document.querySelector("#add-item-form").addEventListener("submit", (event) => {
  event.preventDefault();
  const values = new FormData(event.currentTarget);
  try {
    state = addItem(state, {
      name: values.get("name"),
      owner: values.get("owner"),
      quantity: values.get("quantity"),
      unit: values.get("unit")
    });
    event.currentTarget.reset();
    event.currentTarget.elements.quantity.value = "1";
    event.currentTarget.elements.unit.value = "portion";
    saveAndRender();
    showNotice("Item added to the shared fridge.");
  } catch (error) {
    showNotice(error.message, true);
  }
});

document.querySelector("#reset-demo").addEventListener("click", () => {
  if (!window.confirm("Reset the demo shelf and clear all saved changes on this device?")) return;
  state = createDemoState();
  saveAndRender("Demo fridge reset.");
});

window.setInterval(() => {
  const previous = state;
  state = expireApprovals(state);
  if (previous !== state) saveAndRender("An unclaimed approval expired; inventory was not deducted.");
}, 60_000);

render();
