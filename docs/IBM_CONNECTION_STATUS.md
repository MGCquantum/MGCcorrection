# IBM Quantum connection status

Checked 2026-11-21, 22:13 and 22:45 CST, from `~/MidQwest` (Python 3.13, qiskit 2.6.2, qiskit-ibm-runtime 0.52.1).
Authorization for this check: read-only account and backend discovery plus local transpilation. **No job was
submitted, no session or batch was opened, and no QPU time was used.** Quota consumed this period was 3 s before
the first check and 3 s after the last one.

## Verdict

| Check | Result | Evidence |
|---|---|---|
| Qiskit Runtime authenticates with IBM Quantum (live, remote) | **PASS: Connected** | `QiskitRuntimeService()` built from the saved default account; the IAM exchange and instance resolution succeeded |
| Active instance | **PASS** | `open-instance`, plan `open` (free Open Plan), region `us-east`, channel `ibm_quantum_platform`. The full CRN and account id are deliberately not recorded |
| Real QPUs accessible | **PASS: 3 of 3 operational** | ibm_fez, ibm_kingston, ibm_marrakesh: 156 qubits each, Heron r2, status `active` |
| ibm_kingston / ibm_marrakesh / ibm_fez | **PASS: all accessible** | in `service.backends()` for this instance |
| Queue | recorded | 22:45: fez 0, kingston 2, marrakesh 2 pending jobs (22:13: marrakesh 0, fez 2, kingston 2) |
| Local transpilation against a live target | **PASS** | 3-qubit GHZ, `generate_preset_pass_manager(optimization_level=3)` against the least busy QPU's `Target`: depth 10, 2 CZ, every instruction in the target, every 2-qubit gate on the coupling map. Not submitted |
| Usage quota | 3 s of 600 s used; limit not reached | `service.usage()`, period ending 2026-11-22 04:45 UTC |
| IBM Cloud CLI | **installed, NOT logged in** | `ibmcloud` 2.49.0 at `/usr/local/bin/ibmcloud`; `ibmcloud target` reports "Not logged in". This does **not** affect Qiskit, which uses its own saved API key |
| Historical hardware job unchanged | **PASS** | `results/dc0kvf2nj2vs73de5qvg/`: all 3 SHA-256 sums match `SHA256SUMS`; `git diff` against commit d71655b is empty; re-decoding `measurements.npz` reproduces `record.json` exactly |
| Lab and servers cannot submit jobs or expose tokens | **PASS** | see "Safety design" below; tests listed at the end |

Authentication (the account works) and availability (the devices are online) are reported separately. Connected was
declared only because the live remote calls succeeded. A saved account file or the archived ibm_kingston job was
not taken as evidence.

## How the check works

`~/MidQwest/scripts/ibm_connection_status.py` (new, read-only):

1. Before connecting it replaces `IBMBackend.run`, `SamplerV2.run`, `EstimatorV2.run`, `Sampler.run`,
   `Estimator.run`, `Session.__init__` and `Batch.__init__` with a function that raises, and restores them
   afterwards. A coding mistake fails instead of using QPU time.
2. `QiskitRuntimeService()`, `service.instances()`, `service.usage()`, `service.backends()`, `backend.status()`
   and `backend.target` are its only remote calls, and all of them are reads.
3. It compiles a small circuit locally against the least busy operational QPU.
4. It writes a sanitized snapshot to `~/MidQwest/results/live/ibm_connection_status.json`. That path is git-ignored.
   The writer refuses to save anything that looks like a key, a CRN or a bearer token. When a later check fails,
   the time of the last successful verification is kept.

```
cd ~/MidQwest && .venv/bin/python scripts/ibm_connection_status.py        # exit 0 = connected, >= 1 operational QPU
```

The FastAPI server (`dashboard/server.py`, port 8000) serves that file at `GET /api/ibm-connection`. It never
contacts IBM itself: it has no `QiskitRuntimeService` and no account code, which a test checks. It passes only
allow-listed fields and returns HTTP 500 if anything credential-shaped appears. The lab shows the snapshot on
`/hardware` §8.1 "Current IBM Quantum account and devices". The historical ibm_kingston job is in a separate
section, §8.2.

The panel never polls IBM. The page reads the snapshot once per visit, and only the CLI refreshes it.
Authentication is shown as **Connected** only if the last check succeeded **and** is less than 24 h old.
Otherwise it shows Unknown, with the age of the last check. A failed check shows Disconnected. Hardware execution
always shows **Disabled**.

## If authentication fails later

The script classifies the failure. In every case, keep the API key out of chat, logs and files other than the
Qiskit account store.

| Symptom (`reason` in the snapshot) | Cause | Safe action |
|---|---|---|
| "no saved IBM Quantum account" | `~/.qiskit/qiskit-ibm.json` missing | In your own terminal: `cd ~/MidQwest && .venv/bin/python save_ibm_account.py <INSTANCE_CRN>` (it prompts for the key without echo) |
| "IBM rejected the saved API key" (401/403, BXNIM0415) | key revoked, expired or deleted, or wrong instance | Create a new API key at https://cloud.ibm.com/iam/apikeys, then run `save_ibm_account.py` again in your own terminal |
| "could not reach IBM Quantum (network)" | offline, VPN, DNS, proxy | Fix connectivity. The account is untouched; status stays Unknown |
| `ibmcloud target` says "Not logged in" | the IBM Cloud CLI session only | `ibmcloud login --sso` in your own terminal. Optional: only `scripts/ibmcloud_check.sh` uses it |

## Disclosure

During the first inventory, before I had read `~/MidQwest/CLAUDE.md` (which forbids both), I did two things:

- I opened `~/.qiskit/qiskit-ibm.json` with a script that printed only the field names, the instance CRN and the
  token's length.
- I ran `ibmcloud iam oauth-tokens` with all output sent to `/dev/null`, to test the CLI session. It failed:
  not logged in.

No key or token value was printed, logged or stored. Afterwards I used only the repository's redacting helpers and
the new script.

## Tests

- `~/MidQwest/tests/test_ibm_connection.py`: 18 tests. CRN shortening drops the account id; the writer refuses
  credential-like text; every submission entry point raises inside the guard and is restored afterwards; the
  endpoint returns Unknown without a snapshot, drops non-allow-listed fields, refuses a snapshot containing a CRN
  and survives a corrupt file; the server has no account code. One live, read-only test (`-m ibm`) requires
  Connected, at least one operational QPU, and a clean local transpile.
- `lab/tests/ibm.test.ts` (4) and two Playwright tests in `lab/e2e/lab.spec.ts`. The panel's numbers equal the API
  response; the live panel comes before the archive and contains no archived job id; mocked stale, disconnected and
  never-checked snapshots are never shown as Connected.
