# Rachel endpoint-to-passkey evidence map

Run `AP2-RACHEL-CHAIN-20260822T060500Z` composed the standing Rachel endpoint,
GSA TLS inspection, a separate Rachel-authenticated AP2 browser context, and
Rachel's normal self-service passkey flow without changing a security control or
using a password, stolen token, or replayed session. The marked method existed
only from `06:06:40Z` until Rachel's Security Info deletion was accepted at
`06:12:17Z`.

## Native Microsoft chronology

| UTC | Native record | Result |
| --- | --- | --- |
| 06:06:01.547 | MDE `DeviceProcessEvents` | On `ap2fastrachel`, device `ff9dbde296220e3dc44a0fc5c0ec1ea978159e17`, `explorer.exe` launched `msedge.exe` as `azuread\rachelgreen` / Rachel's exact UPN and SID in logon `27719248`. The command line contains the real `company-access.html` URL and exact run marker. |
| 06:06:02 | GSA traffic `e2e8547c-9237-4e70-ad48-694a3c65353c` | Rachel, managed device `732767fb-a200-48bf-af95-817ed3906d76`, Windows 11 Enterprise, agent 2.31.125, and `msedge.exe` made an allowed successful `GET` to `https://seanewest.github.io/ap2/company-access.html`; response `200`. TLS was intercepted successfully by the standing narrow policy and exact host rule. |
| 06:06:26–27 | Entra sign-ins `3e34a145-775c-444c-a86a-f46e3c9c2f00` / `3e34a145-775c-444c-a86a-f46e419c2f00` | Rachel's interactive `After Party Exploratory` flow recorded successful X.509 MFA and then success from Linux / Chrome 149, unmanaged and noncompliant, with no device identity. Conditional Access succeeded. This source differs from the managed Windows endpoint and was not routed through GSA. |
| 06:06:31 | Entra `Microsoft Account Controls V2` sign-in | The same Linux/Chrome source and address successfully reached the Microsoft account-control surface with MFA satisfied by the preceding CBA claim. |
| 06:06:35–41 | Authentication Methods and Device Registration Service audits | Rachel successfully retrieved passkey creation options, started Passkey registration, added one device-bound passkey, and produced both `User registered Passkey` and `User registered Fido2 Authentication Method`. Every record was initiated by Rachel's exact immutable object and UPN. |
| 06:06:40 | Graph authentication-method inventory | One new FIDO2 method appeared with exact marked display name `AP2-RACHEL-CHAIN-20260822T0605` and creation time `06:06:40Z`. |
| 06:12:17–36 | Authentication Methods audit, Graph inventory, and AVD control-plane reads | Two successful `User deleted security info` records attribute FIDO/FIDO2 deletion to Rachel. Graph returned to the original password method only. Worker-owned AVD session 6 was logged off; the host remained running/available with zero sessions and no power operation. |

The MDE observation contained the exact process event but no matching
`DeviceNetworkEvents` row at capture time. GSA is therefore the native network
record for this run. The GSA record strips the query marker but retains the real
path, method, response, user, device, process, and TLS policy/rule. Correlation
uses its one-second proximity to the exact marked MDE launch.

## Evidence map

| Surface | Defender or learner value | Boundary |
| --- | --- | --- |
| MDE advanced hunting | Exact device, actor, SID, logon, process ancestry, URL, and run marker provide the endpoint entry point. | One `DeviceProcessEvents` row; no matching raw network row was returned. |
| GSA traffic logs | Independently proves the decrypted external transaction and standing TLS control with Rachel/device/Edge attribution, real path, `GET`, `200`, and policy/rule IDs. | The query string is not retained. It proves retrieval, not what Rachel read or clicked. |
| Entra sign-in logs | Establish a later same-user authentication from materially different AP2-controlled Linux/Chrome infrastructure with blank device identity and successful CBA/MFA under Conditional Access. | The expected keep-signed-in interrupt and following success are two records in one supported flow, not two sessions. |
| Authentication Methods audit and Graph inventory | Attribute the self-service persistence action to Rachel and show the exact marked FIDO2 method while present. | Chromium's CTAP2 virtual USB authenticator emulated user presence and verification; this is not a physical key or Windows Hello claim. |
| Standing-state reads | After cleanup, all W73 and YouTrack policies, administrative recovery, FIDO2 policy, W75 GSA/TLS resources, W76 update scope/policies, and Rachel endpoint assignment remained exact. | These are readiness/cleanup observations, not incident activity. |

## AP2 construction receipts only

Owner-only files under the durable runtime record how AP2 constructed and
checked the run. They are not learner or defender evidence:

- AVD controller timestamps and the exact target URL;
- the AP2 screenshot and worker egress `173.61.152.119`;
- the Linux/HeadlessChrome browser-context receipt proving that the same fresh
  context continued from the AP2 session to Security Info;
- the virtual-authenticator credential count and Security Info screenshot;
- controller-side cleanup timestamps and file/process/session checks.

The protected native export is `native-evidence.json`; the post-cleanup read is
`final-native-state.json`. Both are in the run's owner-only runtime directory,
not Git. The retained collector is `scripts/rachel-chain-evidence.mjs`.
