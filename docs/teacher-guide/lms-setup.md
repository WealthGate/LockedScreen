# LMS Setup For Teachers

LOCKEDSCREEN supports two different LMS connection models. They are not the same, and teachers should choose the one that matches their school workflow.

## 1. Direct Assignment Turn-In

Use this when students should submit their finished work to a real LMS assignment from inside LOCKEDSCREEN after the exam has already been saved locally.

Currently supported providers:

- Google Classroom
- Microsoft 365 Education / Teams

This is the workflow to use when a teacher wants to:

- connect a school Google Classroom or Microsoft 365 account
- let the teacher authorize Lockedscreen on the provider's own sign-in page
- load classes from that account
- load assignments from one selected class
- bind an exported exam package to a specific LMS assignment
- let students sign in with their own account after local submission and turn in directly from the app

## 2. Result Sync To Another LMS

Use this when the school wants LOCKEDSCREEN to send results to a webhook, middleware service, Google Sheets ingest endpoint, or another automation layer after submission.

This is the workflow to use for:

- Canvas
- Moodle
- Schoology
- custom school portals
- Microsoft Teams or Google Classroom flows that are handled by school automation rather than direct student turn-in

In this model, LOCKEDSCREEN sends a submission payload to a school-owned endpoint. The external service is responsible for pushing the data into the LMS.

## Before A Teacher Starts

The app expects the school to have the LMS app registration ready first.

For direct assignment turn-in, the teacher needs:

- a school-managed Google or Microsoft account with access to the target classes
- a prepared OAuth client ID
- for Microsoft 365, the tenant ID if the school does not want to use the common tenant setting
- permission to view the classes and assignments that will be used

If the school is using another LMS, the teacher usually needs:

- the middleware or webhook URL from the school IT team
- any bearer token or API key required by that endpoint

## Teacher Setup: Google Classroom Or Microsoft 365

Open `Admin Console`, then use the following steps.

### Step 1. Create An LMS Connection

Go to `LMS connections`.

Choose one provider:

- `Google Classroom`
- `Microsoft 365 Education / Teams`
- `Generic OAuth LMS`

Then fill in the connection details:

- `Label`: a friendly name for the connected account
- `Client ID`: the OAuth client prepared by the school
- `Tenant ID`: Microsoft 365 only
- `OAuth scopes`: leave the default values unless the school IT team gave a different approved scope list

For `Generic OAuth LMS`, the app also asks for:

- `Authorize URL`
- `Token URL`

### Step 2. Save And Connect The Teacher Account

Click `Save connection`, then click `Authorize connection`.

The app opens the system browser so the teacher can sign in to Google, Microsoft, or another OAuth LMS and approve access. After sign-in finishes, the app stores the teacher access token on the admin device.

Important sign-in rule:

- teachers do not type their LMS password directly into Lockedscreen
- Lockedscreen sends the teacher to the provider's own sign-in page
- the teacher can use the same login method already used by the school account, including password, passkey, Microsoft Authenticator, MFA, smart card, or other SSO flow supported by that provider

Important:

- teacher tokens stay on the admin machine
- teacher tokens are not exported to student package files

### Step 3. Verify That Classes Load

Click `Load classes`.

If the connection is correct, the teacher should see:

- Google Classroom courses for Google Classroom
- Microsoft Education classes for Microsoft 365 Education / Teams

This step confirms that the selected account can actually see the classes needed for the exam.

### Step 4. Bind The Exam Package To An Assignment

Open the package in `Admin Console` and go to `Student LMS turn-in`.

Then:

1. Turn on `Enable post-submit student LMS turn-in`.
2. Choose the provider.
3. Choose the connected teacher account.
4. Click `Load classes`.
5. Choose the correct class or course.
6. Click `Load assignments`.
7. Choose the correct assignment.

The package stores:

- the provider
- the client ID
- the tenant ID when applicable
- the selected course ID
- the selected assignment ID

Teachers can also enter course and assignment IDs manually if needed, but loading them from the connected account is safer.

### Step 5. Export The Package

After the package is bound to the right LMS assignment, export it to students as normal.

The exported package includes only the public LMS settings needed for student sign-in and assignment targeting. It does not include the teacher token.

## What Students Experience

The LMS handoff does not replace the secure local submission. It happens after local submission is already complete.

Student flow:

1. The student finishes the exam in LOCKEDSCREEN.
2. LOCKEDSCREEN records the submission locally.
3. The student is then prompted to sign in with their own Google or Microsoft account on the provider's own sign-in page.
4. The app uploads the submission artifact and attaches it to the selected assignment.
5. The app completes the LMS turn-in.

Student sign-in uses the same provider-owned flow:

- Google can prompt for email, password, passkey, or MFA depending on school policy
- Microsoft can prompt for password, Authenticator approval, passkey, or tenant SSO depending on school policy
- Lockedscreen itself does not collect those credentials directly

If the LMS delivery fails, the local exam submission still exists. The LMS turn-in can be retried from the post-submit screen.

## Provider Notes

### Google Classroom

Use direct turn-in when the target assignment already exists in Google Classroom.

Important note:

- the Google Classroom turn-in flow must use the same Google Cloud OAuth client project that the assignment expects

### Microsoft 365 Education / Teams

This path is for Microsoft Education assignments under Microsoft 365.

Important notes:

- the teacher must be able to see the Education classes
- student sign-in must be allowed for the selected tenant
- the Microsoft Graph education assignment permissions must already be approved by the school tenant

## Other LMSs And "So On"

For other LMS platforms, the current teacher workflow is different.

Teachers should use `Results destinations` instead of `Student LMS turn-in`.

Typical setup:

1. Open `Results destinations`.
2. Choose the destination type that best matches the school workflow.
3. Enter the endpoint URL provided by the school.
4. Add bearer token or API key details if required.
5. Choose whether sync should happen manually or automatically on submit.

This works well when the school has:

- a webhook receiver
- an Apps Script endpoint
- a Power Automate flow
- a custom API that writes to Canvas, Moodle, Schoology, Teams, or another LMS

Important limitation:

- direct student turn-in is currently implemented only for Google Classroom and Microsoft 365 Education / Teams
- other LMSs use the generic endpoint-based sync path
- generic OAuth LMS connections can authorize a teacher account, but automatic class and assignment discovery is only built in for Google Classroom and Microsoft 365 Education right now

## Recommended Teacher Message

If you want a short explanation for staff training, use this:

> Teachers connect Google Classroom or Microsoft 365 Education in Admin Console, choose the class and assignment, and export the package. Students still submit locally first. After that, they sign in on the LMS provider page using their normal school login flow and turn in to the LMS. For other LMSs, the school should use a middleware or webhook endpoint in Results destinations instead of direct LMS sign-in.
