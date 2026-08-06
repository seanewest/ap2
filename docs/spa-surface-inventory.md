# Internal SPA role and contents

The SPA is an internal interface for Sean to see, understand, and run AP2
capabilities. It is an interactive companion to `proven-capabilities.md`.
It is not the product, the beginning of a product interface, a learner
interface, or a lab platform. Sean may occasionally show it to a friend, but
that does not change its purpose.

Everything described below should be visible before sign-in. Signing in only
enables action buttons. Rendering the page must not perform tenant or API work.

The SPA has three sections.

## 1. Capabilities

Only items in this section have action buttons.

### Outlook

- Send an email from Homer to Marge.
- Send a help-desk email from Kobe to Cory.
- Create and remove a contact in Cory's account.
- Create and remove a disabled Inbox rule in Cory's account.
- Create and remove an Outlook category in Cory's account.
- Create and remove an unsent draft in Cory's account.

### Calendar and tasks

- Create and cancel a meeting from Cory to Kobe and Marge.
- Create and remove a Microsoft To Do task in Cory's account.

### Files

- Create a OneDrive file as Homer, share it read-only with Marge, and remove it.
- Create and remove a SharePoint file.

## 2. Other things AP2 has proven

These are successful Microsoft experiments that do not currently have SPA
buttons. Their placement is enough; the SPA does not need runnable-status labels
or generalized contracts around them.

- Read directory memberships and basic mailbox, OneDrive, and SharePoint
  information through an application.
- Observe that application's Microsoft Graph sign-in through a separate
  audit-reading application.
- Read users' registered authentication methods and MFA/SSPR registration
  status.
- Check whether the simulated users hold Entra directory roles.
- Read basic Entra device-registration information.
- Create and delete an empty Azure resource group.
- Deploy, join, enroll, secure, use, and remove a personal Azure Virtual Desktop
  Windows machine.
- Deploy and remove a private environment containing one Windows machine and two
  Linux machines.
- Create and remove a security group and change its membership.
- Change and restore a user profile field.
- Set and remove a user's manager.
- Create and remove a disabled Conditional Access policy.
- Read Exchange configuration and message-trace information.
- Read Microsoft Defender Secure Score information.
- Create and remove a mail folder.
- Create and remove temporary Microsoft To Do lists and tasks.
- Stage a private OneDrive document for another fictional user and remove it.
- Produce a real Teams missed-call entry through a controlled user-to-user call.
- Confirm that Microsoft Graph ignored `If-Match` on the tested calendar-event
  deletion.
- Create an application-owned unsent draft and observe it separately.

## 3. Proven scenarios

These are plain descriptions of five capability compositions that were actually
performed. They do not need generic manifests, learner roles, or currently
runnable SPA paths.

- **SharePoint document tampering and recovery:** Create a document, change its
  contents, observe versions and audit evidence, restore the original, and
  clean it up.
- **Inbox-rule persistence and effect:** Create an enabled rule, send a matching
  email, and observe that the rule marked the message as read.
- **Dormant OAuth application remediation:** Create an inert application with a
  temporary credential, discover it through inventory, remove it, and confirm
  its absence.
- **Defender email-attachment prevention:** Send Microsoft's EICAR test
  attachment and observe Defender block and quarantine it through message trace
  and security evidence.
- **Teams group-chat membership remediation:** Create a group chat, add an
  unexpected participant, post a warning message, and have Cory remove that
  participant.

## Interface language

Use ordinary descriptions of what an action or result means. The visible SPA
should not use the terms **lab**, **learner**, **capability building block**,
**rehearsal**, **canary**, **workload**, or **manifest**. Internal source names
may be corrected during implementation cleanup, but they do not belong in the
interface.
