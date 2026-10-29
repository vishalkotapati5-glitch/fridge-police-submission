# FridgePolice — implementation notes

FridgePolice is a small, dependency-free roommate food-sharing prototype. It runs locally in a browser, persists its demo fridge in local storage, and records decisions in an activity feed. Each item card identifies its owner and unique ID; reviewers can request portions, approve or decline them, record consumption, discard spoiled items, correct physical counts, and reset the demo.

## The four scenarios

1. **Two roommates ask for the last 25% of pizza.** Requests do not allocate stock by themselves. Approval checks the item's current unreserved amount and reserves the requested portion immediately. With only 25% left, the first 25% approval makes the available amount zero; approving the other pending 25% fails with a visible message. Recording consumption then deducts the reserved amount once.
2. **Approved food is never claimed, then spoils.** Approvals expire 48 hours after approval. Expiry releases the reservation and does not change the stored quantity or charge the requester. Marking an item spoiled sets its quantity to zero and cancels its pending/approved requests, including reservations, without recording consumption. Expiry is applied when state is read or changed and is also checked every minute while the page is open.
3. **Two roommates add items with identical names.** Each item receives its own ID; requests, corrections, approvals, and discards refer to that ID, never the display name. The demo starts with two independently owned ketchup bottles to make this visible.
4. **The app says food is available, but the real item is gone.** “Update fridge reality” lets a roommate correct the quantity, including setting it to zero. A correction cancels pending requests and reservations for that item, updates its visible state to “Marked gone,” and writes to the activity feed. A spoiled item cannot be restored; a fresh item must be added instead.

## Engineering decisions and assumptions

- The domain logic is isolated in `inventory.js` so reservation, expiry, consumption, spoilage, identity, and correction rules can be tested independently of the UI.
- State transitions return updated state rather than mutating the existing inventory. Approval checks and creates its reservation in one synchronous transition, avoiding two approvals both allocating the same final portion in this single-user, in-memory prototype.
- A reservation lasts 48 hours, is not a deduction, and is cancelled if the item is corrected or discarded. This makes unclaimed food and unexpected spoilage fair to the requester.
- The prototype has no authentication or server-side shared state. Roommate names are entered as labels, and local storage is scoped to the current browser/device. A real multi-device app would need an authenticated backend and a transactional reservation operation.
- Quantities are positive numbers with a user-supplied unit (for example `%`, `bottle`, or `portion`). Zero is supported only when correcting inventory or discarding an item.
- The demo reset clears this prototype's local fridge state and restores the sample pizza and two distinct ketchup bottles.

## Run and verify

Requirements: Node.js 20 or newer. No package installation is needed.

```sh
npm test
npm start
```

Open `http://127.0.0.1:4173`. The test suite uses Node's built-in test runner and covers all four disaster scenarios plus normal approval, rejection, consumption, and duplicate-item creation.
